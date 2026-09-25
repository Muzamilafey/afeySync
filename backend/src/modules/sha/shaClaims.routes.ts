import { Router, type Request } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { AppError, badRequest, conflict, forbidden } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { canAccessBranch } from '../../middleware/branchScope';
import { audit } from '../audit/auditService';
import { loadScoped, oid, round2 } from '../common/helpers';
import { nextSequence, type TenantModels } from '../../models/tenant';
import { hieRequest } from '../../integrations/hie/hieClient';
import { toClaim } from '../fhir/mappers';
import { fhirConfig } from '../fhir/outbox';
import { validateResource } from '../fhir/validator';
import { completePayment, recalcInvoice } from '../billing/billingService';
import { txPermission } from './sha.routes';

/**
 * SHA claim lifecycle on top of the local transaction record:
 *   draft → submitted → pending → approved | rejected | intervention_required → paid
 * Submission goes through the HIE contract operation for the transaction kind. Those operations are declared
 * without a path until the platform owner configures them from the official HIE documentation, so until
 * then submission fails with INTEGRATION_OPERATION_NOT_CONFIGURED and the record stays in draft — nothing
 * is ever marked as submitted without a successful response from SHA.
 */
const router = Router();
router.use(authenticateTenant);

type Tx = NonNullable<Awaited<ReturnType<TenantModels['ShaTransaction']['findOne']>>>;
type Kind = keyof typeof txPermission;

const SUBMIT_OPERATION: Record<Kind, string> = {
  authorization: 'sha.authorization.create',
  visit_consent: 'sha.visit.consent.start',
  preauthorization: 'sha.preauth.create',
  claim: 'sha.claim.discharge',
  emergency_claim: 'sha.emergency.claim.create',
};
/** Errors that mean "not sent at all" (configuration), as opposed to a failed exchange with SHA. */
const NOT_SENT = new Set(['INTEGRATION_OPERATION_NOT_CONFIGURED', 'INTEGRATION_DISABLED', 'INTEGRATION_NOT_ENABLED_FOR_FACILITY', 'INTEGRATION_NOT_CONFIGURED']);

const ctx = (req: Request) => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });

function transition(tx: Tx, status: Tx['status'], source: string, note?: string) {
  tx.status = status;
  tx.statusHistory.push({ status, at: new Date(), source, note });
}

async function loadTx(req: Request, id: unknown, perm?: 'kind' | string) {
  const tx = await loadScoped(req, req.tenant!.models.ShaTransaction, id, 'Transaction');
  const need = perm === 'kind' ? txPermission[tx.kind as Kind] : perm;
  if (need && !req.permissions!.has(need)) throw forbidden(`Missing permission: ${need}`);
  return tx;
}

const pickRef = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  const inner = (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>;
  for (const k of ['claim_id', 'claimId', 'reference', 'transaction_id', 'transactionId', 'preauth_id', 'id']) {
    const v = o[k] ?? inner[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return undefined;
};

async function buildClaimPayload(req: Request, tx: Tx) {
  const m = req.tenant!.models;
  const patient = await m.Patient.findById(tx.patientId).select('clientRegistryId shaNumber').lean();
  const claim = toClaim(await fhirConfig(m, req.tenant!.slug), tx.toObject() as never, req.tenant!.id) as Record<string, unknown>;
  if (patient?.clientRegistryId) (claim.patient as Record<string, unknown>).identifier = { type: { text: 'ClientRegistry ID' }, value: patient.clientRegistryId };
  return { claim, patient };
}

/* Create a claim from a SHA invoice: billable lines + diagnoses from finalized consultations. */
router.post(
  '/transactions/from-invoice',
  requirePermission('sha.claim'),
  h(async (req, res) => {
    const body = parse(z.object({ invoiceId: z.string(), kind: z.enum(['claim', 'emergency_claim']).default('claim'), benefitCode: z.string().max(60).optional(), interventionCode: z.string().max(60).optional(), accessPoint: z.enum(['OP', 'IP']).optional(), parentId: z.string().optional(), clinicalJustification: z.string().max(4000).optional() }), req.body);
    const m = req.tenant!.models;
    const inv = await loadScoped(req, m.Invoice, body.invoiceId, 'Invoice');
    if (inv.status === 'void') throw conflict('Invoice is void', undefined, 'INVOICE_VOID');
    if (inv.payer?.type !== 'sha') throw new AppError(422, 'INVOICE_NOT_SHA', 'Only invoices billed to SHA can be claimed. Change the visit payer to SHA first.');
    const active = await m.ShaTransaction.findOne({ invoiceId: inv._id, kind: { $in: ['claim', 'emergency_claim'] }, status: { $nin: ['cancelled', 'rejected'] } }).select('reference').lean();
    if (active) throw conflict(`Claim ${active.reference} already exists for this invoice`, { id: active._id }, 'CLAIM_EXISTS');
    const lines = inv.lines.filter((l) => !l.voided && l.amount > 0).map((l) => ({ serviceCode: l.serviceCode, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: round2(l.amount) }));
    if (!lines.length) throw badRequest('The invoice has no billable lines');
    const consults = inv.visitId ? await m.Consultation.find({ visitId: inv.visitId, status: 'final' }).select('diagnoses').lean() : [];
    const seen = new Set<string>();
    const diagnoses = consults.flatMap((c) => c.diagnoses).filter((d) => { const k = d.code ?? d.display; if (seen.has(k)) return false; seen.add(k); return true; }).map((d) => ({ code: d.code ?? '', display: d.display, system: d.system ?? undefined }));
    if (body.parentId) {
      const parent = await loadTx(req, body.parentId);
      if (String(parent.patientId) !== String(inv.patientId) || parent.status !== 'approved') throw new AppError(422, 'INVALID_PARENT', 'The linked preauthorization must be approved and for the same patient');
    }
    const admission = inv.visitId ? await m.Admission.exists({ visitId: inv.visitId }) : null;
    const seq = await nextSequence(m, `sha_${body.kind}`);
    const tx = await m.ShaTransaction.create({
      kind: body.kind,
      reference: `SHA-${body.kind === 'claim' ? 'CLM' : 'EMC'}-${String(seq).padStart(6, '0')}`,
      idempotencyKey: `invoice:${inv._id}:${body.kind}:${seq}`,
      patientId: inv.patientId,
      branchId: inv.branchId,
      visitId: inv.visitId,
      invoiceId: inv._id,
      parentId: body.parentId,
      benefitCode: body.benefitCode,
      interventionCode: body.interventionCode,
      accessPoint: body.accessPoint ?? (admission ? 'IP' : 'OP'),
      diagnoses,
      lines,
      clinicalJustification: body.clinicalJustification,
      amounts: { claimed: round2(lines.reduce((s, l) => s + l.amount, 0)) },
      status: 'draft',
      statusHistory: [{ status: 'draft', at: new Date(), source: 'user', note: `From invoice ${inv.invoiceNumber}` }],
      createdBy: req.user!.id,
    });
    await audit(req, { action: `sha.${body.kind}.draft`, resource: 'sha_transaction', resourceId: String(tx._id), newValue: { reference: tx.reference, invoice: inv.invoiceNumber, claimed: tx.amounts?.claimed } });
    res.status(201).json({ success: true, data: tx });
  }),
);

/* Edit a draft (or a record sent back for correction). */
router.patch(
  '/transactions/:id',
  h(async (req, res) => {
    const body = parse(
      z.object({
        benefitCode: z.string().max(60).optional(),
        interventionCode: z.string().max(60).optional(),
        accessPoint: z.enum(['OP', 'IP']).optional(),
        diagnoses: z.array(z.object({ code: z.string().max(30), display: z.string().max(200), system: z.string().max(100).optional() })).max(20).optional(),
        lines: z.array(z.object({ serviceCode: z.string().max(40), description: z.string().max(200), quantity: z.number().positive(), unitPrice: z.number().min(0) })).max(100).optional(),
        clinicalJustification: z.string().max(4000).optional(),
      }),
      req.body,
    );
    const tx = await loadTx(req, req.params.id, 'kind');
    if (!['draft', 'failed'].includes(tx.status)) throw conflict(`A ${tx.status} transaction cannot be edited. Use resubmit to reopen it.`, undefined, 'SHA_TX_LOCKED');
    const before = { lines: tx.lines, diagnoses: tx.diagnoses, amounts: tx.amounts };
    const { lines, ...rest } = body;
    tx.set(rest);
    if (lines) {
      tx.set('lines', lines.map((l) => ({ ...l, amount: round2(l.quantity * l.unitPrice) })));
      tx.set('amounts.claimed', round2(tx.lines.reduce((s, l) => s + (l.amount ?? 0), 0)));
    }
    await tx.save();
    await audit(req, { action: `sha.${tx.kind}.edit`, resource: 'sha_transaction', resourceId: String(tx._id), oldValue: before, newValue: body });
    res.json({ success: true, data: tx });
  }),
);

router.get(
  '/transactions/:id/fhir',
  requirePermission('sha.view'),
  h(async (req, res) => {
    const tx = await loadTx(req, req.params.id);
    const { claim } = await buildClaimPayload(req, tx);
    res.json({ success: true, data: { resource: claim, validation: validateResource(claim as never) } });
  }),
);

router.post(
  '/transactions/:id/attachments',
  h(async (req, res) => {
    const { documentId } = parse(z.object({ documentId: z.string() }), req.body);
    const tx = await loadTx(req, req.params.id, 'kind');
    const doc = await req.tenant!.models.Document.findOne({ _id: oid(documentId, 'Document'), deletedAt: null }).select('patientId').lean();
    if (!doc || String(doc.patientId) !== String(tx.patientId)) throw badRequest('Document not found for this patient');
    await req.tenant!.models.ShaTransaction.updateOne({ _id: tx._id }, { $addToSet: { attachmentIds: doc._id } });
    res.json({ success: true });
  }),
);

/* Submit through the configured HIE contract operation. */
router.post(
  '/transactions/:id/submit',
  h(async (req, res) => {
    const tx = await loadTx(req, req.params.id, 'kind');
    if (!['draft', 'failed'].includes(tx.status)) throw conflict(`Transaction is already ${tx.status}`, undefined, 'SHA_TX_ALREADY_SUBMITTED');
    const kind = tx.kind as Kind;
    const problems: string[] = [];
    if (['claim', 'emergency_claim', 'preauthorization'].includes(kind) && !tx.lines.length) problems.push('At least one service line is required');
    if (['claim', 'emergency_claim', 'preauthorization'].includes(kind) && !tx.diagnoses.length) problems.push('At least one diagnosis is required');
    if (['claim', 'preauthorization'].includes(kind) && !tx.interventionCode) problems.push('SHA intervention code is required');
    const { claim, patient } = await buildClaimPayload(req, tx);
    if (!patient?.clientRegistryId) problems.push('Patient has no Client Registry ID (search the DHA Client Registry first)');
    problems.push(...validateResource(claim as never));
    if (problems.length) throw new AppError(422, 'SHA_TX_INCOMPLETE', 'The transaction is not ready to submit', problems);

    const attempt = (tx.submissions ?? 0) + 1;
    tx.requestPayload = claim as never;
    try {
      const r = await hieRequest('sha', ctx(req), { operation: SUBMIT_OPERATION[kind], body: claim, idempotencyKey: `${tx.idempotencyKey}:s${attempt}` });
      tx.submissions = attempt;
      tx.submittedAt = new Date();
      tx.submittedBy = req.user!.id as never;
      tx.lastResponse = r.data as never;
      tx.externalReference = pickRef(r.data) ?? tx.externalReference;
      transition(tx, 'submitted', 'sha', `HTTP ${r.status}`);
      await tx.save();
      await audit(req, { action: `sha.${kind}.submit`, resource: 'sha_transaction', resourceId: String(tx._id), newValue: { reference: tx.reference, externalReference: tx.externalReference, attempt } });
      res.json({ success: true, data: tx });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'ERROR';
      tx.lastResponse = { error: code, message: (err as Error).message, at: new Date() } as never;
      if (!NOT_SENT.has(code)) {
        tx.submissions = attempt;
        transition(tx, 'failed', 'sha', `${code}: ${(err as Error).message}`.slice(0, 300));
      }
      await tx.save();
      await audit(req, { action: `sha.${kind}.submit`, resource: 'sha_transaction', resourceId: String(tx._id), result: 'failure', newValue: { code } });
      throw err;
    }
  }),
);

/* Record a decision received outside of callbacks (e.g. read on the SHA provider portal). */
router.post(
  '/transactions/:id/decision',
  h(async (req, res) => {
    const body = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'intervention_required']), approvedAmount: z.number().min(0).optional(), externalReference: z.string().max(80).optional(), note: z.string().min(5).max(1000) }), req.body);
    const tx = await loadTx(req, req.params.id, 'kind');
    if (!['submitted', 'pending', 'intervention_required'].includes(tx.status)) throw conflict(`Cannot record a decision on a ${tx.status} transaction`, undefined, 'INVALID_SHA_TRANSITION');
    if (body.status === 'approved' && body.approvedAmount === undefined) throw badRequest('approvedAmount is required for approvals');
    if ((body.approvedAmount ?? 0) > (tx.amounts?.claimed ?? 0)) throw badRequest('Approved amount cannot exceed the claimed amount');
    const before = tx.status;
    if (body.approvedAmount !== undefined) tx.set('amounts.approved', round2(body.approvedAmount));
    if (body.externalReference) tx.externalReference = body.externalReference;
    tx.decisionNote = body.note;
    transition(tx, body.status, 'manual', body.note);
    await tx.save();
    await audit(req, { action: `sha.${tx.kind}.decision`, resource: 'sha_transaction', resourceId: String(tx._id), oldValue: { status: before }, newValue: body });
    res.json({ success: true, data: tx });
  }),
);

/* Respond to an intervention (query) raised by SHA. */
router.post(
  '/transactions/:id/intervention-response',
  requirePermission('sha.intervention'),
  h(async (req, res) => {
    const body = parse(z.object({ response: z.string().min(5).max(4000) }), req.body);
    const tx = await loadTx(req, req.params.id);
    if (tx.status !== 'intervention_required') throw conflict('This transaction has no open intervention', undefined, 'INVALID_SHA_TRANSITION');
    const r = await hieRequest('sha', ctx(req), { operation: 'sha.intervention.respond', body: { reference: tx.externalReference ?? tx.reference, response: body.response }, idempotencyKey: `${tx.idempotencyKey}:ir${tx.statusHistory.length}` });
    tx.lastResponse = r.data as never;
    transition(tx, 'pending', 'sha', 'Intervention response sent');
    await tx.save();
    await audit(req, { action: `sha.${tx.kind}.intervention_response`, resource: 'sha_transaction', resourceId: String(tx._id) });
    res.json({ success: true, data: tx });
  }),
);

/* Reopen a rejected / queried / failed transaction for correction and resubmission. */
router.post(
  '/transactions/:id/resubmit',
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(500) }), req.body);
    const tx = await loadTx(req, req.params.id, 'kind');
    if (!['rejected', 'intervention_required', 'failed'].includes(tx.status)) throw conflict(`A ${tx.status} transaction cannot be reopened`, undefined, 'INVALID_SHA_TRANSITION');
    transition(tx, 'draft', 'user', `Reopened: ${reason}`);
    await tx.save();
    await audit(req, { action: `sha.${tx.kind}.reopen`, resource: 'sha_transaction', resourceId: String(tx._id), newValue: { reason } });
    res.json({ success: true, data: tx });
  }),
);

router.post(
  '/transactions/:id/cancel',
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(500) }), req.body);
    const tx = await loadTx(req, req.params.id, 'kind');
    if (!['draft', 'failed'].includes(tx.status)) throw conflict('Only unsent transactions can be cancelled locally', undefined, 'INVALID_SHA_TRANSITION');
    transition(tx, 'cancelled', 'user', reason);
    await tx.save();
    await audit(req, { action: `sha.${tx.kind}.cancel`, resource: 'sha_transaction', resourceId: String(tx._id), newValue: { reason } });
    res.json({ success: true, data: tx });
  }),
);

/* Record an SHA remittance: posts a Payment (method 'sha') to the claim's invoice. Idempotent per reference. */
router.post(
  '/transactions/:id/reconcile',
  requirePermission('sha.reconciliation'),
  h(async (req, res) => {
    const body = parse(z.object({ amount: z.number().positive().max(100_000_000), reference: z.string().trim().min(3).max(80), note: z.string().max(300).optional() }), req.body);
    const m = req.tenant!.models;
    const tx = await loadTx(req, req.params.id);
    if (!['claim', 'emergency_claim'].includes(tx.kind)) throw badRequest('Only claims can be reconciled');
    const idempotencyKey = `sha:${tx._id}:${body.reference.toUpperCase()}`;
    const existing = await m.Payment.findOne({ idempotencyKey }).lean();
    if (existing) return res.json({ success: true, data: { transaction: tx, payment: existing }, idempotentReplay: true });
    if (!['approved', 'paid'].includes(tx.status)) throw conflict('Only approved claims can be reconciled', undefined, 'INVALID_SHA_TRANSITION');
    const ceiling = tx.amounts?.approved ?? tx.amounts?.claimed ?? 0;
    const paidSoFar = tx.amounts?.paid ?? 0;
    if (round2(paidSoFar + body.amount) > ceiling + 0.001) throw new AppError(422, 'OVERPAYMENT', `Remittance exceeds the approved amount (${ceiling}, already received ${paidSoFar})`);
    const inv = tx.invoiceId ? await m.Invoice.findById(tx.invoiceId) : null;
    if (inv && !canAccessBranch(req, inv.branchId)) throw forbidden();
    if (inv) await recalcInvoice(m, inv);
    if (inv && body.amount > (inv.totals?.balance ?? 0) + 0.001) throw new AppError(422, 'OVERPAYMENT', `Remittance exceeds the invoice balance (${inv.totals?.balance ?? 0})`);
    const payment = await m.Payment.create({ invoiceId: inv?._id, patientId: tx.patientId, branchId: tx.branchId, method: 'sha', amount: round2(body.amount), reference: body.reference, idempotencyKey, status: 'pending', receivedBy: req.user!.id, receivedByName: req.user!.name, notes: body.note ?? `SHA remittance for ${tx.reference}` });
    await completePayment(m, payment);
    tx.remittances.push({ amount: round2(body.amount), reference: body.reference, paymentId: payment._id, at: new Date(), by: req.user!.id as never });
    tx.set('amounts.paid', round2(paidSoFar + body.amount));
    if ((tx.amounts?.paid ?? 0) >= ceiling - 0.001) transition(tx, 'paid', 'user', `Remittance ${body.reference}`);
    await tx.save();
    await audit(req, { action: 'sha.claim.reconcile', resource: 'sha_transaction', resourceId: String(tx._id), newValue: { amount: body.amount, reference: body.reference, receipt: payment.receiptNumber } });
    res.json({ success: true, data: { transaction: tx, payment } });
  }),
);

/* ---------------- Emergency claims: protocols and attending doctors (HIE contract operations) */
router.get(
  '/emergency/protocols',
  requirePermission('sha.claim'),
  h(async (req, res) => {
    const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v).slice(0, 100)]));
    const r = await hieRequest('sha', ctx(req), { operation: 'sha.emergency.protocols.list', query });
    res.json({ success: true, data: r.data });
  }),
);

async function loadEmergency(req: Request) {
  const tx = await loadTx(req, req.params.id, 'sha.claim');
  if (tx.kind !== 'emergency_claim') throw badRequest('Only emergency claims have protocols and attending doctors');
  if (!tx.externalReference) throw conflict('Submit the emergency claim to SHA first', undefined, 'SHA_TX_NOT_SUBMITTED');
  if (['cancelled', 'paid'].includes(tx.status)) throw conflict(`Emergency claim is ${tx.status}`, undefined, 'INVALID_SHA_TRANSITION');
  return tx;
}

router.post(
  '/transactions/:id/emergency/protocols',
  h(async (req, res) => {
    const body = parse(z.object({ code: z.string().min(1).max(60), name: z.string().max(200).optional(), notes: z.string().max(1000).optional() }), req.body);
    const tx = await loadEmergency(req);
    if (tx.emergency?.protocols?.some((p) => p.code === body.code)) throw conflict('Protocol already added');
    const r = await hieRequest('sha', ctx(req), { operation: 'sha.emergency.protocol.add', body: { claim_reference: tx.externalReference, protocol_code: body.code, notes: body.notes }, idempotencyKey: `${tx.idempotencyKey}:proto:${body.code}` });
    tx.set('emergency.protocols', [...(tx.emergency?.protocols ?? []), { ...body, addedAt: new Date(), by: req.user!.id }]);
    tx.lastResponse = r.data as never;
    await tx.save();
    await audit(req, { action: 'sha.emergency.protocol_add', resource: 'sha_transaction', resourceId: String(tx._id), newValue: body });
    res.json({ success: true, data: tx });
  }),
);

router.post(
  '/transactions/:id/emergency/doctors',
  h(async (req, res) => {
    const { userId } = parse(z.object({ userId: z.string() }), req.body);
    const tx = await loadEmergency(req);
    const u = await req.tenant!.models.User.findById(oid(userId, 'User')).select('name practitioner').lean();
    const reg = u?.practitioner?.licenseNumber ?? u?.practitioner?.registryId;
    if (!u || !reg) throw badRequest('The doctor needs a licence or Health Worker Registry number on their user profile');
    if (tx.emergency?.doctors?.some((d) => d.registrationNumber === reg)) throw conflict('Doctor already added');
    const r = await hieRequest('sha', ctx(req), { operation: 'sha.emergency.doctor.add', body: { claim_reference: tx.externalReference, registration_number: reg }, idempotencyKey: `${tx.idempotencyKey}:doc:${reg}` });
    tx.set('emergency.doctors', [...(tx.emergency?.doctors ?? []), { userId: u._id, name: u.name, registrationNumber: reg, addedAt: new Date() }]);
    tx.lastResponse = r.data as never;
    await tx.save();
    await audit(req, { action: 'sha.emergency.doctor_add', resource: 'sha_transaction', resourceId: String(tx._id), newValue: { doctor: u.name, registrationNumber: reg } });
    res.json({ success: true, data: tx });
  }),
);

router.delete(
  '/transactions/:id/emergency/doctors/:reg',
  h(async (req, res) => {
    const tx = await loadEmergency(req);
    const reg = String(req.params.reg);
    if (!tx.emergency?.doctors?.some((d) => d.registrationNumber === reg)) throw badRequest('Doctor is not on this claim');
    await hieRequest('sha', ctx(req), { operation: 'sha.emergency.doctor.remove', body: { claim_reference: tx.externalReference, registration_number: reg } });
    tx.set('emergency.doctors', (tx.emergency?.doctors ?? []).filter((d) => d.registrationNumber !== reg));
    await tx.save();
    await audit(req, { action: 'sha.emergency.doctor_remove', resource: 'sha_transaction', resourceId: String(tx._id), newValue: { registrationNumber: reg } });
    res.json({ success: true, data: tx });
  }),
);

export default router;
