import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { pagination, parse } from '../../utils/validate';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { meta } from '../../models/meta';
import { assertProvider, assertTenantCredentialsAllowed, integrationStatusForTenant, toPublicConfig, upsertConfig } from '../integrations/integrationConfigService';
import { loadConfigForTest, testIntegration } from '../integrations/testers';
import { clearTokenCache } from '../../integrations/hie/hieClient';

const router = Router();
router.use(authenticateTenant);

/* Integrations: facilities see enablement only; credentials only if the owner allows facility credentials. */
router.get(
  '/integrations',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    const status = await integrationStatusForTenant(req.tenant!.id);
    const tenantCfgs = await meta().IntegrationConfig.find({ scope: 'tenant', tenantId: req.tenant!.id });
    const facilityConfigs: Record<string, unknown> = {};
    for (const [provider, s] of Object.entries(status)) {
      if (s.tenantCredentialsAllowed) facilityConfigs[provider] = toPublicConfig(tenantCfgs.find((c) => c.provider === provider) ?? null, provider as never);
    }
    res.json({ success: true, data: { status, facilityConfigs } });
  }),
);

router.put(
  '/integrations/:provider',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    if (req.user!.branchAccess !== 'all') throw forbidden('Only tenant-wide administrators can manage integrations');
    const provider = assertProvider(req.params.provider as string);
    await assertTenantCredentialsAllowed(provider);
    const body = parse(
      z.object({
        enabled: z.boolean().optional(),
        environment: z.enum(['sandbox', 'uat', 'production']).optional(),
        settings: z.record(z.string(), z.string().max(500)).optional(),
        secrets: z.record(z.string(), z.string().max(8000)).optional(),
        useTenantConfig: z.boolean().optional(),
      }),
      req.body,
    );
    const { before, after } = await upsertConfig('tenant', provider, req.tenant!.id, body, req.user!.id);
    clearTokenCache();
    await audit(req, { action: 'integration.facility_config', resource: 'integration', resourceId: provider, oldValue: before, newValue: { ...after, secretsChanged: Object.keys(body.secrets ?? {}) } });
    res.json({ success: true, data: after });
  }),
);

router.post(
  '/integrations/:provider/test',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    const provider = assertProvider(req.params.provider as string);
    await assertTenantCredentialsAllowed(provider);
    const cfg = await loadConfigForTest('tenant', provider, req.tenant!.id);
    const result = await testIntegration(cfg, 'auth', { tenantId: req.tenant!.id });
    await audit(req, { action: 'integration.test', resource: 'integration', resourceId: provider, result: result.ok ? 'success' : 'failure' });
    res.json({ success: true, data: result });
  }),
);

/* System health → integrations (facility view, no secrets) */
router.get(
  '/system-health/integrations',
  requirePermission('admin.integrations'),
  h(async (req, res) => {
    const status = await integrationStatusForTenant(req.tenant!.id);
    const since = new Date(new Date().setHours(0, 0, 0, 0));
    const { IntegrationLog } = meta();
    const agg = await IntegrationLog.aggregate([
      { $match: { tenantId: new (await import('mongoose')).Types.ObjectId(req.tenant!.id), createdAt: { $gte: since } } },
      { $group: { _id: { provider: '$provider', status: '$status' }, count: { $sum: 1 }, avgLatency: { $avg: '$latencyMs' }, last: { $max: '$createdAt' } } },
    ]);
    const data = Object.entries(status).map(([provider, s]) => {
      const ok = agg.find((a) => a._id.provider === provider && a._id.status === 'success');
      const bad = agg.find((a) => a._id.provider === provider && a._id.status === 'failure');
      return { provider, ...s, lastSuccess: ok?.last ?? null, lastFailure: bad?.last ?? null, latencyMs: ok ? Math.round(ok.avgLatency) : null, requestsToday: (ok?.count ?? 0) + (bad?.count ?? 0), failuresToday: bad?.count ?? 0 };
    });
    res.json({ success: true, data });
  }),
);

/* Support access approvals */
router.get(
  '/support-access',
  requirePermission('admin.support_access'),
  h(async (req, res) => {
    res.json({ success: true, data: await meta().SupportAccessGrant.find({ tenantId: req.tenant!.id }).sort({ createdAt: -1 }).limit(100).lean() });
  }),
);

router.post(
  '/support-access/:id/:decision',
  requirePermission('admin.support_access'),
  h(async (req, res) => {
    const decision = req.params.decision as string;
    if (!['approve', 'reject', 'revoke'].includes(decision)) throw notFound();
    if (req.user!.kind !== 'tenant') throw forbidden('Support sessions cannot approve support access');
    if (!isValidObjectId(req.params.id)) throw notFound();
    const grant = await meta().SupportAccessGrant.findOne({ _id: req.params.id, tenantId: req.tenant!.id });
    if (!grant) throw notFound('Request not found');
    if (decision !== 'revoke' && grant.status !== 'pending') throw conflict('Request already decided');
    if (decision === 'approve') {
      grant.status = 'approved';
      grant.approvedAt = new Date();
      grant.expiresAt = new Date(Date.now() + grant.durationMinutes * 60_000);
    } else grant.status = decision === 'reject' ? 'rejected' : 'revoked';
    grant.approvedBy = req.user!.id as never;
    grant.approvedByName = req.user!.name;
    await grant.save();
    if (decision === 'revoke') await meta().Session.updateMany({ subjectType: 'support', tenantId: req.tenant!.id, subjectId: grant.requestedBy, revokedAt: null }, { revokedAt: new Date(), revokedReason: 'support_revoked' });
    await audit(req, { action: `support_access.${decision}`, resource: 'support_access', resourceId: String(grant._id), newValue: { status: grant.status, expiresAt: grant.expiresAt } });
    res.json({ success: true, data: grant });
  }),
);

/* Facility settings */
router.get(
  '/settings',
  requirePermission('admin.settings'),
  h(async (req, res) => {
    res.json({ success: true, data: await req.tenant!.models.FacilitySetting.find({}).lean() });
  }),
);

const SETTING_KEYS = ['patientNumberPrefix', 'sessionTimeoutMinutes', 'currency', 'timezone', 'receiptFooter', 'allowNewPatientWithoutRegistryCheck'] as const;
router.put(
  '/settings/:key',
  requirePermission('admin.settings'),
  h(async (req, res) => {
    const key = req.params.key as string;
    if (!(SETTING_KEYS as readonly string[]).includes(key)) throw notFound('Unknown setting');
    const { value } = parse(z.object({ value: z.union([z.string().max(200), z.number(), z.boolean()]) }), req.body);
    if (key === 'patientNumberPrefix' && (typeof value !== 'string' || !/^[A-Z]{2,5}$/.test(value))) throw forbidden('Prefix must be 2-5 uppercase letters');
    const { FacilitySetting } = req.tenant!.models;
    const before = await FacilitySetting.findOne({ key }).lean();
    await FacilitySetting.updateOne({ key }, { $set: { value } }, { upsert: true });
    await audit(req, { action: 'settings.update', resource: 'setting', resourceId: key, oldValue: before?.value, newValue: value });
    res.json({ success: true });
  }),
);

/* Audit trail */
router.get(
  '/audit',
  requirePermission('admin.audit'),
  h(async (req, res) => {
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = {};
    for (const k of ['action', 'resource', 'resourceId', 'result'] as const) if (req.query[k]) filter[k] = String(req.query[k]);
    if (req.query.userId && isValidObjectId(req.query.userId)) filter.userId = req.query.userId;
    if (req.user!.branchAccess !== 'all') filter.branchId = { $in: req.user!.branchIds };
    const { AuditLog } = req.tenant!.models;
    const [items, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

export default router;
