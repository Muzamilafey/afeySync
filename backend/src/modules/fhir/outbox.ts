import type { Request } from 'express';
import type { TenantModels } from '../../models/tenant';
import { enqueueJob } from '../../jobs/queue';
import { bundle, defaultConfig, toConditions, toEncounter, toObservations, toPatient, toProvenance, type FhirConfig } from './mappers';
import { validateResource } from './validator';

export async function fhirConfig(m: TenantModels, tenantSlug: string): Promise<FhirConfig> {
  const base = defaultConfig(tenantSlug);
  const [profiles, systems] = await Promise.all([m.FacilitySetting.findOne({ key: 'fhir.profiles' }).lean(), m.FacilitySetting.findOne({ key: 'fhir.identifierSystems' }).lean()]);
  return { ...base, profiles: { ...base.profiles, ...((profiles?.value as Record<string, string>) ?? {}) }, systems: { ...base.systems, ...((systems?.value as Record<string, string>) ?? {}) } };
}

/**
 * Clinical record → FHIR mapper → validation → outbox → queue → DHA SHR.
 * Idempotent per resource version: re-finalizing or retrying never creates a duplicate outbox entry.
 */
export async function enqueueFhirForConsultation(req: Request, consultationId: string) {
  const m = req.tenant!.models;
  const c = await m.Consultation.findById(consultationId).lean();
  if (!c || c.status !== 'final') return null;
  const [visit, patient, vitals] = await Promise.all([m.Visit.findById(c.visitId).lean(), m.Patient.findById(c.patientId).lean(), m.Vitals.find({ visitId: c.visitId }).lean()]);
  if (!visit || !patient) return null;
  const cfg = await fhirConfig(m, req.tenant!.slug);
  const conditions = toConditions(cfg, c as never);
  const encounter = toEncounter(cfg, visit as never, { providerId: c.providerId, locationId: visit.branchId, diagnoses: conditions.map((x, i) => ({ conditionId: x.id as string, rank: i + 1 })) });
  const observations = vitals.flatMap((v) => toObservations(cfg, v as never));
  const resources = [toPatient(cfg, patient as never), encounter, ...conditions, ...observations];
  resources.push(toProvenance(cfg, resources.map((r) => `${r.resourceType}/${r.id}`), c.providerId, c.finalizedAt ?? new Date(), 'Consultation finalized'));
  const payload = bundle('transaction', resources as never, cfg);
  const errors = validateResource(payload as never);
  const version = 1 + (c.addenda?.length ?? 0);
  const idempotencyKey = `consultation:${c._id}:v${version}`;
  const existing = await m.FhirOutbox.findOne({ idempotencyKey }).lean();
  if (existing) return existing;
  const entry = await m.FhirOutbox.create({ resourceType: 'Bundle', localResource: 'consultation', localId: String(c._id), version, idempotencyKey, payload, validation: { valid: errors.length === 0, errors: errors.slice(0, 50) }, status: errors.length ? 'failed' : 'queued', lastError: errors.length ? 'FHIR validation failed' : undefined });
  if (!errors.length) await enqueueJob('FHIR_SYNC', `${req.tenant!.id}:${idempotencyKey}`, { outboxId: String(entry._id) }, req.tenant!.id);
  return entry;
}
