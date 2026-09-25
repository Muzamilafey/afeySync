import { env } from '../../config/env';
import { clearFacilityIdentityCache } from '../../integrations/hie/hieClient';
import { platformMfaPolicy } from '../auth/ownerAuth.routes';
import { policySchema } from '../auth/mfa/mfaService';
import { Router } from 'express';
import os from 'node:os';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { escapeRegex, pagination, parse } from '../../utils/validate';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { authenticatePlatform, requirePermission } from '../../middleware/auth';
import { meta, PROVIDERS, type Provider } from '../../models/meta';
import { getTenantConnection, getTenantModels } from '../../db/tenantManager';
import { platformAudit } from '../audit/auditService';
import { branchInput, createFacilitySchema, provisionFacility, refreshTenantStats } from '../tenants/provisioning';
import { invalidateTenantCache } from '../tenants/tenantLoader';
import { clearDomainCache } from '../../middleware/tenantResolver';
import { hashPassword, passwordPolicy } from '../auth/password';
import { createSession, revokeAllForSubject, signAccessToken } from '../auth/tokens';
import { assertProvider, toPublicConfig, upsertConfig } from '../integrations/integrationConfigService';
import { loadConfigForTest, testIntegration } from '../integrations/testers';
import { invalidateContractCache } from '../../integrations/hie/contractService';
import { clearTokenCache } from '../../integrations/hie/hieClient';
import { randomToken } from '../../utils/crypto';
import { getConnectionStats } from '../health/health.routes';
import { ALL_TENANT_PERMISSIONS } from '../rbac/catalog';

const router = Router();
router.use(authenticatePlatform);

const oid = (id: string) => {
  if (!isValidObjectId(id)) throw notFound();
  return id;
};

/* ------------------------------------------------------------------ Dashboard */
router.get(
  '/dashboard',
  h(async (_req, res) => {
    const { Tenant, IntegrationConfig, IntegrationLog, TenantSubscription, Job } = meta();
    const since = new Date(Date.now() - 24 * 3600_000);
    const [total, active, suspended, statsAgg, integrations, failures24h, calls24h, subs, deadJobs, onlineCount] = await Promise.all([
      Tenant.countDocuments({}),
      Tenant.countDocuments({ status: 'active' }),
      Tenant.countDocuments({ status: 'suspended' }),
      Tenant.aggregate([{ $group: { _id: null, branches: { $sum: '$stats.branches' }, users: { $sum: '$stats.users' } } }]),
      IntegrationConfig.find({ scope: 'platform' }).select('provider enabled health').lean(),
      IntegrationLog.countDocuments({ status: 'failure', createdAt: { $gte: since } }),
      IntegrationLog.countDocuments({ createdAt: { $gte: since } }),
      TenantSubscription.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 }, revenue: { $sum: '$amount' } } }]),
      Job.countDocuments({ status: 'dead' }),
      Tenant.countDocuments({ 'stats.lastActivityAt': { $gte: new Date(Date.now() - 15 * 60_000) } }),
    ]);
    const issues = failures24h + deadJobs + integrations.filter((i) => i.enabled && i.health?.status === 'failed').length;
    res.json({
      success: true,
      data: {
        tenants: { total, active, suspended, online: onlineCount },
        branches: statsAgg[0]?.branches ?? 0,
        users: statsAgg[0]?.users ?? 0,
        issues,
        integrations: PROVIDERS.filter((p) => p !== 'storage').map((p) => {
          const c = integrations.find((i) => i.provider === p);
          return { provider: p, enabled: c?.enabled ?? false, status: c?.health?.status ?? 'unknown', lastSuccessAt: c?.health?.lastSuccessAt, lastFailureAt: c?.health?.lastFailureAt };
        }),
        apiUsage: { calls24h, failures24h },
        subscriptions: subs.map((s) => ({ plan: s._id, count: s.count, revenue: s.revenue })),
        deadJobs,
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  }),
);

/* ------------------------------------------------------------------ Facilities */
router.get(
  '/tenants',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const { Tenant, TenantSubscription } = meta();
    const { page, limit, skip } = pagination(req.query);
    const q = String(req.query.q ?? '').trim();
    const filter: Record<string, unknown> = {};
    if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { slug: new RegExp(escapeRegex(q), 'i') }, { facilityCode: new RegExp(escapeRegex(q), 'i') }, { county: new RegExp(escapeRegex(q), 'i') }];
    if (req.query.status) filter.status = String(req.query.status);
    const [items, total] = await Promise.all([Tenant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Tenant.countDocuments(filter)]);
    const subs = await TenantSubscription.find({ tenantId: { $in: items.map((t) => t._id) } }).lean();
    res.json({
      success: true,
      data: items.map((t) => ({
        id: t._id,
        name: t.name,
        slug: t.slug,
        facilityCode: t.facilityCode,
        county: t.county,
        status: t.status,
        branches: t.stats?.branches ?? 0,
        users: t.stats?.users ?? 0,
        lastActivityAt: t.stats?.lastActivityAt,
        integrations: t.integrations,
        subscription: subs.find((s) => String(s.tenantId) === String(t._id)) ?? null,
        createdAt: t.createdAt,
      })),
      meta: { page, limit, total },
    });
  }),
);

router.post(
  '/tenants',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const input = parse(createFacilitySchema, req.body);
    const result = await provisionFacility(input, req.platformUser!.id);
    await platformAudit(req, { action: 'tenant.create', resource: 'tenant', resourceId: String(result.tenant._id), tenantId: String(result.tenant._id), newValue: { slug: input.facility.slug, name: input.facility.name, domains: result.domains, branches: result.branches.length } });
    res.status(201).json({
      success: true,
      data: {
        id: result.tenant._id,
        slug: result.tenant.slug,
        dbName: result.dbName,
        domains: result.domains,
        branches: result.branches,
        admin: result.admin,
        checklist: ['Tenant created', 'Database created', 'Admin created', 'Domain registered', 'Default roles created', 'Default permissions created', 'Default configuration created'],
      },
    });
  }),
);

router.get(
  '/tenants/:id',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { Tenant, TenantDomain, TenantSubscription, TenantDatabase } = meta();
    const tenant = await Tenant.findById(id).lean();
    if (!tenant) throw notFound('Facility not found');
    const [domains, subscription, db] = await Promise.all([TenantDomain.find({ tenantId: id }).lean(), TenantSubscription.findOne({ tenantId: id }).sort({ createdAt: -1 }).lean(), TenantDatabase.findOne({ tenantId: id }).lean()]);
    // Administrative (non-clinical) data only: branches and staff directory.
    let branches: unknown[] = [];
    let users: unknown[] = [];
    if (db) {
      const m = getTenantModels(db.dbName);
      branches = await m.Branch.find({}).select('-__v').sort({ isMain: -1 }).lean();
      users = await m.User.find({}).select('name email status branchAccess lastLoginAt roleIds').populate('roleIds', 'name key').lean();
    }
    res.json({ success: true, data: { tenant, domains, subscription, database: db ? { dbName: db.dbName, status: db.status, lastBackupAt: db.lastBackupAt } : null, branches, users } });
  }),
);

const tenantUpdate = createFacilitySchema.shape.facility.omit({ slug: true }).partial();
router.patch(
  '/tenants/:id',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parse(tenantUpdate, req.body);
    const { Tenant } = meta();
    const before = await Tenant.findById(id).lean();
    if (!before) throw notFound('Facility not found');
    const { dhaFacilityRegistryCode, ...rest } = body;
    const update: Record<string, unknown> = { ...rest };
    if (dhaFacilityRegistryCode !== undefined) update['dhaRegistry.facilityRegistryCode'] = dhaFacilityRegistryCode;
    const after = await Tenant.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' }).lean();
    invalidateTenantCache(id);
    clearFacilityIdentityCache();
    await platformAudit(req, { action: 'tenant.update', resource: 'tenant', resourceId: id, tenantId: id, oldValue: before, newValue: after });
    res.json({ success: true, data: after });
  }),
);

for (const action of ['suspend', 'activate'] as const) {
  router.post(
    `/tenants/:id/${action}`,
    requirePermission('owner.tenants'),
    h(async (req, res) => {
      const id = oid(req.params.id as string);
      const { reason } = parse(z.object({ reason: z.string().max(500).optional() }), req.body ?? {});
      if (action === 'suspend' && !reason) throw badRequest('A reason is required to suspend a facility');
      const { Tenant } = meta();
      const t = await Tenant.findById(id);
      if (!t) throw notFound('Facility not found');
      if (t.status === 'provisioning') throw conflict('Facility is still provisioning');
      t.status = action === 'suspend' ? 'suspended' : 'active';
      t.suspendedReason = action === 'suspend' ? reason : undefined;
      await t.save();
      invalidateTenantCache(id);
      await platformAudit(req, { action: `tenant.${action}`, resource: 'tenant', resourceId: id, tenantId: id, newValue: { status: t.status, reason } });
      res.json({ success: true, data: { status: t.status } });
    }),
  );
}

router.post(
  '/tenants/:id/reset-admin',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parse(z.object({ email: z.string().email() }), req.body);
    const db = await meta().TenantDatabase.findOne({ tenantId: id }).lean();
    if (!db) throw notFound('Facility not found');
    const m = getTenantModels(db.dbName);
    const user = await m.User.findOne({ email: body.email.toLowerCase() });
    if (!user) throw notFound('User not found in this facility');
    const roles = await m.Role.find({ _id: { $in: user.roleIds }, key: { $in: ['facility_admin', 'facility_owner'] } }).lean();
    if (!roles.length) throw forbidden('Only facility administrator accounts can be reset from the owner portal');
    const temporaryPassword = `Afs-${randomToken(9)}9a`;
    user.passwordHash = await hashPassword(temporaryPassword);
    user.mustChangePassword = true;
    user.lockedUntil = undefined;
    user.failedLogins = 0;
    user.status = 'active';
    // An administrator locked out by a lost second factor is recovered by the same reset.
    user.set('mfa', { totp: { lastStep: -1 }, recoveryCodes: [] });
    await user.save();
    await revokeAllForSubject(String(user._id), 'admin_reset');
    await m.AuditLog.create({ actorType: 'system', action: 'user.admin_reset_by_platform', resource: 'user', resourceId: String(user._id), newValue: { by: req.platformUser!.email } });
    await platformAudit(req, { action: 'tenant.reset_admin', resource: 'user', resourceId: String(user._id), tenantId: id, newValue: { email: user.email } });
    res.json({ success: true, data: { email: user.email, temporaryPassword } });
  }),
);

router.post(
  '/tenants/:id/branches',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parse(branchInput, req.body);
    const db = await meta().TenantDatabase.findOne({ tenantId: id }).lean();
    if (!db) throw notFound('Facility not found');
    const m = getTenantModels(db.dbName);
    const sub = await meta().TenantSubscription.findOne({ tenantId: id }).sort({ createdAt: -1 }).lean();
    if (sub && (await m.Branch.countDocuments({})) >= (sub.maxBranches ?? 1)) throw forbidden('Subscription branch limit reached', 'SUBSCRIPTION_LIMIT');
    const branch = await m.Branch.create({ ...body, email: body.email || undefined, branchCode: body.branchCode.toUpperCase() });
    await m.StockLocation.create([{ name: `${branch.branchName} Pharmacy`, branchId: branch._id, type: 'pharmacy' }, { name: `${branch.branchName} Main Store`, branchId: branch._id, type: 'store' }]);
    await refreshTenantStats(id, m);
    await platformAudit(req, { action: 'branch.create', resource: 'branch', resourceId: String(branch._id), tenantId: id, newValue: body });
    res.status(201).json({ success: true, data: branch });
  }),
);

/* Domains */
router.post(
  '/tenants/:id/domains',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parse(z.object({ hostname: z.string().toLowerCase().regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/), type: z.enum(['custom', 'branch']).default('custom'), branchId: z.string().optional() }), req.body);
    const { TenantDomain, Tenant } = meta();
    if (!(await Tenant.exists({ _id: id }))) throw notFound('Facility not found');
    if (await TenantDomain.exists({ hostname: body.hostname })) throw conflict('Domain already in use', undefined, 'DOMAIN_TAKEN');
    const d = await TenantDomain.create({ tenantId: id, hostname: body.hostname, type: body.type, branchId: body.branchId && isValidObjectId(body.branchId) ? body.branchId : undefined, verified: false, verificationToken: `afeysync-verify=${randomToken(16)}` });
    clearDomainCache();
    await platformAudit(req, { action: 'domain.add', resource: 'domain', resourceId: String(d._id), tenantId: id, newValue: { hostname: body.hostname } });
    res.status(201).json({ success: true, data: d, instructions: `Create a TXT record on ${body.hostname} with value "${d.verificationToken}" and point the domain (CNAME/A) to the AfeySync edge, then verify.` });
  }),
);

router.post(
  '/tenants/:id/domains/:domainId/verify',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { TenantDomain } = meta();
    const d = await TenantDomain.findOne({ _id: oid(req.params.domainId as string), tenantId: id });
    if (!d) throw notFound('Domain not found');
    const dns = await import('node:dns/promises');
    const records = await dns.resolveTxt(d.hostname).catch(() => [] as string[][]);
    const ok = records.some((r) => r.join('') === d.verificationToken);
    if (!ok) throw badRequest(`TXT record "${d.verificationToken}" not found on ${d.hostname}`, undefined, 'DOMAIN_VERIFICATION_FAILED');
    d.verified = true;
    await d.save();
    clearDomainCache();
    await platformAudit(req, { action: 'domain.verify', resource: 'domain', resourceId: String(d._id), tenantId: id });
    res.json({ success: true, data: d });
  }),
);

router.delete(
  '/tenants/:id/domains/:domainId',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { TenantDomain } = meta();
    const d = await TenantDomain.findOne({ _id: oid(req.params.domainId as string), tenantId: id });
    if (!d) throw notFound('Domain not found');
    if (d.type === 'platform_subdomain') throw forbidden('The platform subdomain cannot be removed');
    await d.deleteOne();
    clearDomainCache();
    await platformAudit(req, { action: 'domain.remove', resource: 'domain', resourceId: String(d._id), tenantId: id, oldValue: { hostname: d.hostname } });
    res.json({ success: true });
  }),
);

/* Subscription */
router.put(
  '/tenants/:id/subscription',
  requirePermission('owner.subscriptions'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parse(
      z.object({
        plan: z.enum(['trial', 'basic', 'standard', 'premium', 'enterprise']),
        status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
        billingCycle: z.enum(['monthly', 'quarterly', 'annual']),
        amount: z.number().min(0),
        maxBranches: z.number().int().min(1),
        maxUsers: z.number().int().min(1),
        endsAt: z.coerce.date().optional(),
        notes: z.string().max(500).optional(),
      }).partial(),
      req.body,
    );
    const { TenantSubscription } = meta();
    const before = await TenantSubscription.findOne({ tenantId: id }).sort({ createdAt: -1 }).lean();
    const after = await TenantSubscription.findOneAndUpdate({ tenantId: id }, { $set: body }, { returnDocument: 'after', upsert: true, sort: { createdAt: -1 } }).lean();
    await platformAudit(req, { action: 'subscription.update', resource: 'subscription', resourceId: String(after?._id), tenantId: id, oldValue: before, newValue: after });
    res.json({ success: true, data: after });
  }),
);

/* Per-facility integration enablement */
router.put(
  '/tenants/:id/integrations',
  requirePermission('owner.integrations'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const body = parse(z.object({ sha: z.boolean(), dha: z.boolean(), mpesa: z.boolean(), africastalking: z.boolean(), smtp: z.boolean() }).partial(), req.body);
    const { Tenant } = meta();
    const before = await Tenant.findById(id).select('integrations').lean();
    if (!before) throw notFound('Facility not found');
    const set: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(body)) set[`integrations.${k}`] = v;
    await Tenant.updateOne({ _id: id }, { $set: set });
    const after = await Tenant.findById(id).select('integrations').lean();
    await platformAudit(req, { action: 'tenant.integrations', resource: 'tenant', resourceId: id, tenantId: id, oldValue: before.integrations, newValue: after?.integrations });
    res.json({ success: true, data: after?.integrations });
  }),
);

router.get(
  '/tenants/:id/health',
  requirePermission('owner.tenants'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const db = await meta().TenantDatabase.findOne({ tenantId: id }).lean();
    if (!db) throw notFound('Facility not found');
    const conn = getTenantConnection(db.dbName);
    const started = Date.now();
    const stats = await conn.db!.stats().catch(() => null);
    const pingMs = Date.now() - started;
    await meta().TenantDatabase.updateOne({ _id: db._id }, { lastHealthCheckAt: new Date() });
    const failures = await meta().IntegrationLog.countDocuments({ tenantId: id, status: 'failure', createdAt: { $gte: new Date(Date.now() - 86400_000) } });
    res.json({
      success: true,
      data: {
        database: { name: db.dbName, status: stats ? 'healthy' : 'unreachable', pingMs, collections: stats?.collections, dataSizeBytes: stats?.dataSize, storageSizeBytes: stats?.storageSize, indexes: stats?.indexes },
        integrationFailures24h: failures,
        lastBackupAt: db.lastBackupAt ?? null,
      },
    });
  }),
);

router.get(
  '/tenants/:id/audit',
  requirePermission('owner.logs'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    const { page, limit, skip } = pagination(req.query);
    const { PlatformAuditLog } = meta();
    const [items, total] = await Promise.all([PlatformAuditLog.find({ tenantId: id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), PlatformAuditLog.countDocuments({ tenantId: id })]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

/* ------------------------------------------------------------------ Platform integrations */
router.get(
  '/integrations',
  requirePermission('owner.integrations'),
  h(async (_req, res) => {
    const docs = await meta().IntegrationConfig.find({ scope: 'platform', tenantId: null });
    res.json({ success: true, data: PROVIDERS.map((p) => toPublicConfig(docs.find((d) => d.provider === p) ?? null, p)) });
  }),
);

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  environment: z.enum(['sandbox', 'uat', 'production']).optional(),
  settings: z.record(z.string(), z.string().max(500)).optional(),
  secrets: z.record(z.string(), z.string().max(8000)).optional(),
  allowTenantCredentials: z.boolean().optional(),
});

router.put(
  '/integrations/:provider',
  requirePermission('owner.integrations'),
  h(async (req, res) => {
    const provider = assertProvider(req.params.provider as string);
    const body = parse(configUpdateSchema, req.body);
    const { before, after } = await upsertConfig('platform', provider, null, body, req.platformUser!.id);
    clearTokenCache();
    await platformAudit(req, {
      action: body.secrets && Object.keys(body.secrets).length ? 'integration.credentials_rotated' : 'integration.update',
      resource: 'integration',
      resourceId: provider,
      oldValue: before,
      newValue: { ...after, secretsChanged: Object.keys(body.secrets ?? {}) },
    });
    res.json({ success: true, data: after });
  }),
);

router.post(
  '/integrations/:provider/test',
  requirePermission('owner.integrations'),
  h(async (req, res) => {
    const provider = assertProvider(req.params.provider as string) as Provider;
    const body = parse(z.object({ kind: z.enum(['auth', 'registry', 'eligibility', 'terminology', 'email']).default('auth'), to: z.string().email().optional(), sample: z.object({ type: z.string(), number: z.string() }).optional() }), req.body ?? {});
    const cfg = await loadConfigForTest('platform', provider, null);
    const result = await testIntegration(cfg, body.kind, { to: body.to, sample: body.sample });
    await platformAudit(req, { action: 'integration.test', resource: 'integration', resourceId: provider, newValue: { kind: body.kind, ok: result.ok }, result: result.ok ? 'success' : 'failure' });
    res.json({ success: true, data: result });
  }),
);

router.get(
  '/integration-logs',
  requirePermission('owner.logs'),
  h(async (req, res) => {
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = {};
    if (req.query.tenantId && isValidObjectId(req.query.tenantId)) filter.tenantId = req.query.tenantId;
    for (const k of ['provider', 'operation', 'status'] as const) if (req.query[k]) filter[k] = String(req.query[k]);
    if (req.query.reference) filter.$or = [{ externalReference: String(req.query.reference) }, { requestId: String(req.query.reference) }];
    if (req.query.from || req.query.to) {
      const range: Record<string, Date> = {};
      if (req.query.from) range.$gte = new Date(String(req.query.from));
      if (req.query.to) range.$lte = new Date(String(req.query.to));
      filter.createdAt = range;
    }
    const { IntegrationLog } = meta();
    const [items, total] = await Promise.all([IntegrationLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), IntegrationLog.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

/* Contracts (API Config) */
router.get(
  '/contracts/:provider',
  requirePermission('owner.integrations'),
  h(async (req, res) => {
    const provider = assertProvider(req.params.provider as string);
    const contract = await meta().IntegrationContract.findOne({ provider, active: true }).sort({ updatedAt: -1 }).lean();
    res.json({ success: true, data: contract });
  }),
);

const opSchema = z.object({
  key: z.string().min(3).max(80),
  path: z
    .string()
    .max(300)
    .regex(/^\/[A-Za-z0-9\-._~{}/]*$/, 'Path must start with / and contain only URL path characters')
    .nullable(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  documentationRef: z.string().max(300).optional(),
});

router.patch(
  '/contracts/:provider',
  requirePermission('owner.integrations'),
  h(async (req, res) => {
    const provider = assertProvider(req.params.provider as string);
    const body = parse(z.object({ contractVersion: z.string().min(1).max(60), documentationURL: z.string().url().optional(), operations: z.array(opSchema).max(200) }), req.body);
    const { IntegrationContract } = meta();
    const contract = await IntegrationContract.findOne({ provider, active: true }).sort({ updatedAt: -1 });
    if (!contract) throw notFound('Contract not found');
    const before = contract.toObject();
    for (const op of body.operations) {
      const existing = contract.supportedOperations.find((o) => o.key === op.key);
      if (!existing) throw badRequest(`Unknown operation ${op.key}`);
      existing.path = op.path;
      existing.method = op.method;
      existing.documented = Boolean(op.path);
      existing.verification = op.path ? 'owner_verified' : undefined;
      if (op.documentationRef) existing.documentationRef = op.documentationRef;
    }
    contract.contractVersion = body.contractVersion;
    if (body.documentationURL) contract.documentationURL = body.documentationURL;
    contract.lastVerified = new Date();
    contract.verifiedBy = req.platformUser!.email;
    await contract.save();
    invalidateContractCache();
    await platformAudit(req, { action: 'integration.contract_update', resource: 'integration_contract', resourceId: provider, oldValue: { version: before.contractVersion }, newValue: { version: body.contractVersion, operations: body.operations } });
    res.json({ success: true, data: contract });
  }),
);

/* ------------------------------------------------------------------ Platform two-factor policy */
router.get(
  '/security/mfa-policy',
  requirePermission('owner.platform'),
  h(async (_req, res) => {
    res.json({ success: true, data: await platformMfaPolicy() });
  }),
);

router.put(
  '/security/mfa-policy',
  requirePermission('owner.platform'),
  h(async (req, res) => {
    const policy = parse(policySchema, req.body);
    await meta().PlatformSettings.updateOne({ key: 'security.mfa' }, { $set: { value: policy } }, { upsert: true });
    await platformAudit(req, { action: 'platform.mfa_policy', resource: 'setting', resourceId: 'security.mfa', newValue: policy });
    res.json({ success: true, data: await platformMfaPolicy() });
  }),
);

router.post(
  '/users/:id/mfa/reset',
  requirePermission('owner.platform'),
  h(async (req, res) => {
    const id = oid(req.params.id as string);
    if (String(id) === req.platformUser!.id) throw forbidden('Ask another platform administrator to reset your two-factor authentication');
    const u = await meta().PlatformUser.findById(id);
    if (!u) throw notFound('User not found');
    u.set('mfa', { totp: { lastStep: -1 }, recoveryCodes: [] });
    await u.save();
    await revokeAllForSubject(String(u._id), 'mfa_reset');
    await platformAudit(req, { action: 'platform_user.mfa_reset', resource: 'platform_user', resourceId: String(u._id) });
    res.json({ success: true });
  }),
);

/* ------------------------------------------------------------------ Backups (written by deploy/backup.sh) */
const BACKUP_STALE_HOURS = 26;
router.get(
  '/backups',
  requirePermission('owner.platform'),
  h(async (_req, res) => {
    const { Tenant, TenantDatabase, BackupRun } = meta();
    const [tenants, dbs, runs, metaRun] = await Promise.all([
      Tenant.find().select('name slug status').lean(),
      TenantDatabase.find().select('tenantId dbName status lastBackupAt').lean(),
      BackupRun.find().sort({ createdAt: -1 }).limit(100).lean(),
      BackupRun.findOne({ dbName: { $not: new RegExp(`^${env.TENANT_DB_PREFIX}`) }, status: 'success' }).sort({ createdAt: -1 }).lean(),
    ]);
    const byTenant = new Map(dbs.map((d) => [String(d.tenantId), d]));
    const cutoff = Date.now() - BACKUP_STALE_HOURS * 3600_000;
    const facilities = tenants.map((t) => {
      const d = byTenant.get(String(t._id));
      const last = d?.lastBackupAt ?? null;
      const lastRun = runs.find((r) => r.dbName === d?.dbName);
      return { tenantId: t._id, name: t.name, slug: t.slug, status: t.status, dbName: d?.dbName, lastBackupAt: last, stale: !last || new Date(last).getTime() < cutoff, lastRunFailed: lastRun?.status === 'failure' };
    });
    res.json({ success: true, data: { staleAfterHours: BACKUP_STALE_HOURS, metaLastBackupAt: metaRun?.createdAt ?? null, facilities, recentRuns: runs } });
  }),
);

/* ------------------------------------------------------------------ Platform health */
router.get(
  '/system/health',
  h(async (_req, res) => {
    const started = Date.now();
    await meta().PlatformUser.db.db!.admin().ping().catch(() => null);
    const mongoMs = Date.now() - started;
    const { Job, IntegrationConfig } = meta();
    const [queued, dead, configs] = await Promise.all([Job.countDocuments({ status: 'queued' }), Job.countDocuments({ status: 'dead' }), IntegrationConfig.find({ scope: 'platform' }).select('provider enabled health').lean()]);
    const load = os.loadavg()[0];
    const cpuPct = Math.min(100, Math.round((load / os.cpus().length) * 100));
    const ramPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
    let storagePct: number | null = null;
    try {
      const s = await fs.statfs('/');
      storagePct = Math.round(((s.blocks - s.bavail) / s.blocks) * 100);
    } catch {
      storagePct = null;
    }
    res.json({
      success: true,
      data: {
        api: 'healthy',
        mongodb: { status: mongoMs < 1000 ? 'healthy' : 'degraded', pingMs: mongoMs, ...getConnectionStats() },
        queue: { status: dead > 0 ? 'degraded' : 'healthy', queued, dead },
        integrations: PROVIDERS.filter((p) => p !== 'storage').map((p) => {
          const c = configs.find((x) => x.provider === p);
          return { provider: p, enabled: c?.enabled ?? false, status: c?.enabled ? (c?.health?.status ?? 'unknown') : 'disabled', lastSuccessAt: c?.health?.lastSuccessAt, lastFailureAt: c?.health?.lastFailureAt, latencyMs: c?.health?.lastLatencyMs };
        }),
        resources: { cpuPct, ramPct, storagePct, uptimeSeconds: Math.round(process.uptime()), node: process.version },
      },
    });
  }),
);

/* ------------------------------------------------------------------ Platform users */
router.get(
  '/users',
  requirePermission('owner.platform'),
  h(async (_req, res) => {
    res.json({ success: true, data: await meta().PlatformUser.find({}).select('name email role status lastLoginAt createdAt mfa.totp.confirmedAt mfa.email.enabledAt google.email').lean() });
  }),
);

router.post(
  '/users',
  requirePermission('owner.platform'),
  h(async (req, res) => {
    const body = parse(z.object({ name: z.string().min(2), email: z.string().email(), role: z.enum(['super_owner', 'platform_admin', 'platform_support']), password: passwordPolicy }), req.body);
    const { PlatformUser } = meta();
    if (await PlatformUser.exists({ email: body.email.toLowerCase() })) throw conflict('User already exists');
    const u = await PlatformUser.create({ name: body.name, email: body.email, role: body.role, passwordHash: await hashPassword(body.password) });
    await platformAudit(req, { action: 'platform_user.create', resource: 'platform_user', resourceId: String(u._id), newValue: { email: u.email, role: u.role } });
    res.status(201).json({ success: true, data: { id: u._id, name: u.name, email: u.email, role: u.role } });
  }),
);

router.get(
  '/audit',
  requirePermission('owner.logs'),
  h(async (req, res) => {
    const { page, limit, skip } = pagination(req.query, 200);
    const filter: Record<string, unknown> = {};
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.tenantId && isValidObjectId(req.query.tenantId)) filter.tenantId = req.query.tenantId;
    const { PlatformAuditLog } = meta();
    const [items, total] = await Promise.all([PlatformAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), PlatformAuditLog.countDocuments(filter)]);
    res.json({ success: true, data: items, meta: { page, limit, total } });
  }),
);

/* ------------------------------------------------------------------ Jobs (retry failed integration jobs) */
router.get(
  '/jobs',
  requirePermission('owner.logs'),
  h(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.type) filter.type = String(req.query.type);
    const items = await meta().Job.find(filter).select('-payload').sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ success: true, data: items });
  }),
);

router.post(
  '/jobs/:id/retry',
  requirePermission('owner.integrations'),
  h(async (req, res) => {
    const job = await meta().Job.findById(oid(req.params.id as string));
    if (!job) throw notFound('Job not found');
    if (!['dead', 'failed'].includes(job.status)) throw conflict('Only failed or dead-lettered jobs can be retried');
    job.status = 'queued';
    job.attempts = 0;
    job.runAt = new Date();
    job.lastError = undefined;
    await job.save();
    await platformAudit(req, { action: 'job.retry', resource: 'job', resourceId: String(job._id), tenantId: job.tenantId ? String(job.tenantId) : undefined });
    res.json({ success: true });
  }),
);

/* ------------------------------------------------------------------ Support access (break-glass) */
router.post(
  '/support-access',
  requirePermission('owner.support'),
  h(async (req, res) => {
    const body = parse(
      z.object({
        tenantId: z.string().refine(isValidObjectId, 'Invalid tenant'),
        reason: z.string().min(15, 'Give a specific reason (min 15 characters)').max(1000),
        durationMinutes: z.number().int().min(15).max(240),
        permissions: z.array(z.string()).min(1).max(20),
      }),
      req.body,
    );
    const invalid = body.permissions.filter((p) => !ALL_TENANT_PERMISSIONS.includes(p) || p.startsWith('admin.'));
    if (invalid.length) throw badRequest(`Permissions not grantable to support: ${invalid.join(', ')}`);
    if (!(await meta().Tenant.exists({ _id: body.tenantId }))) throw notFound('Facility not found');
    const grant = await meta().SupportAccessGrant.create({ ...body, requestedBy: req.platformUser!.id, requestedByEmail: req.platformUser!.email, status: 'pending' });
    await platformAudit(req, { action: 'support_access.request', resource: 'support_access', resourceId: String(grant._id), tenantId: body.tenantId, newValue: body });
    res.status(201).json({ success: true, data: grant });
  }),
);

router.get(
  '/support-access',
  requirePermission('owner.support'),
  h(async (req, res) => {
    const filter = req.platformUser!.role === 'super_owner' ? {} : { requestedBy: req.platformUser!.id };
    res.json({ success: true, data: await meta().SupportAccessGrant.find(filter).sort({ createdAt: -1 }).limit(100).lean() });
  }),
);

/** Exchange an APPROVED grant for a short-lived, audited tenant session limited to the granted permissions. */
router.post(
  '/support-access/:id/session',
  requirePermission('owner.support'),
  h(async (req, res) => {
    const grant = await meta().SupportAccessGrant.findById(oid(req.params.id as string)).lean();
    if (!grant || String(grant.requestedBy) !== req.platformUser!.id) throw notFound('Grant not found');
    if (grant.status !== 'approved' || !grant.expiresAt || grant.expiresAt < new Date()) throw forbidden('Support access is not approved or has expired', 'SUPPORT_ACCESS_INVALID');
    const { session } = await createSession({ subjectType: 'support', subjectId: req.platformUser!.id, tenantId: String(grant.tenantId), ip: req.ip, userAgent: req.get('user-agent'), expiresAt: grant.expiresAt });
    const ttl = Math.max(60, Math.min(1800, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)));
    const accessToken = signAccessToken({ sub: req.platformUser!.id, scope: 'support', sid: String(session._id), tid: String(grant.tenantId), gid: String(grant._id) }, ttl);
    const db = await meta().TenantDatabase.findOne({ tenantId: grant.tenantId }).lean();
    if (db) await getTenantModels(db.dbName).AuditLog.create({ actorType: 'support', userId: req.platformUser!.id, userName: req.platformUser!.email, action: 'support_access.session_started', resource: 'support_access', resourceId: String(grant._id), ip: req.ip });
    await platformAudit(req, { action: 'support_access.session', resource: 'support_access', resourceId: String(grant._id), tenantId: String(grant.tenantId) });
    res.json({ success: true, data: { accessToken, expiresIn: ttl, permissions: grant.permissions } });
  }),
);

export default router;
