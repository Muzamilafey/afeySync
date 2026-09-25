import { z } from 'zod';
import { meta } from '../../models/meta';
import { ensureTenantIndexes, tenantModels, type TenantModels } from '../../models/tenant';
import { getTenantConnection, tenantDbName } from '../../db/tenantManager';
import { ALL_TENANT_PERMISSIONS, DEFAULT_ROLES, PERMISSION_GROUPS } from '../rbac/catalog';
import { hashPassword, passwordPolicy } from '../auth/password';
import { conflict } from '../../utils/errors';
import { randomToken } from '../../utils/crypto';
import { platformSubdomain, clearDomainCache } from '../../middleware/tenantResolver';
import { logger } from '../../utils/logger';
import { seedTenantCatalogs } from './seedCatalogs';
import { TENANT_SCHEMA_VERSION } from './migrations';

const hostname = z
  .string()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Invalid hostname');

export const branchInput = z.object({
  branchName: z.string().min(2).max(120),
  branchCode: z.string().min(2).max(20).regex(/^[A-Za-z0-9-]+$/),
  facilityCode: z.string().max(40).optional(),
  registrationNumber: z.string().max(60).optional(),
  facilityLevel: z.string().max(40).optional(),
  facilityType: z.string().max(60).optional(),
  county: z.string().max(60).optional(),
  subCounty: z.string().max(60).optional(),
  ward: z.string().max(60).optional(),
  physicalAddress: z.string().max(300).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  bedCapacity: z.number().int().min(0).max(5000).optional(),
});

export const createFacilitySchema = z.object({
  facility: z.object({
    name: z.string().min(2).max(160),
    slug: z.string().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'Slug may contain lowercase letters, digits and hyphens'),
    legalName: z.string().max(200).optional(),
    facilityCode: z.string().max(40).optional(),
    registrationNumber: z.string().max(60).optional(),
    facilityLevel: z.string().max(40).optional(),
    facilityType: z.string().max(60).optional(),
    ownership: z.string().max(60).optional(),
    county: z.string().max(60).optional(),
    subCounty: z.string().max(60).optional(),
    phone: z.string().max(30).optional(),
    email: z.string().email().optional().or(z.literal('')),
    physicalAddress: z.string().max(300).optional(),
    dhaFacilityRegistryCode: z.string().max(60).optional(),
  }),
  administrator: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(30).optional(),
    password: passwordPolicy.optional(),
  }),
  domain: z.object({ customDomains: z.array(hostname).max(5).default([]) }).default({ customDomains: [] }),
  branches: z.array(branchInput).min(1).max(50),
  integrations: z
    .object({ sha: z.boolean(), dha: z.boolean(), mpesa: z.boolean(), africastalking: z.boolean(), smtp: z.boolean(), slade360: z.boolean() })
    .partial()
    .default({}),
  subscription: z
    .object({
      plan: z.enum(['trial', 'basic', 'standard', 'premium', 'enterprise']).default('trial'),
      billingCycle: z.enum(['monthly', 'quarterly', 'annual']).default('monthly'),
      amount: z.number().min(0).default(0),
      maxBranches: z.number().int().min(1).default(1),
      maxUsers: z.number().int().min(1).default(10),
      endsAt: z.coerce.date().optional(),
    })
    .default({ plan: 'trial', billingCycle: 'monthly', amount: 0, maxBranches: 1, maxUsers: 10 }),
});
export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;

export async function seedTenantRbac(m: TenantModels) {
  for (const [group, g] of Object.entries(PERMISSION_GROUPS)) {
    for (const [key, description] of Object.entries(g.permissions)) {
      await m.Permission.updateOne({ key }, { $set: { key, group, description } }, { upsert: true });
    }
  }
  for (const role of DEFAULT_ROLES) {
    await m.Role.updateOne(
      { key: role.key },
      { $set: { name: role.name, scope: role.scope, system: true, permissions: role.permissions.filter((p) => ALL_TENANT_PERMISSIONS.includes(p)) } },
      { upsert: true },
    );
  }
}

/**
 * Creates a facility end-to-end: tenant metadata, dedicated database, indexes, RBAC, branches,
 * administrator, domains, subscription and default configuration. Rolls back everything it created
 * if any step fails.
 */
/** `adminPasswordHash`: a password the administrator already chose (self-service onboarding); they are not forced to change it. */
export async function provisionFacility(input: CreateFacilityInput, actorId?: string, opts: { adminPasswordHash?: string } = {}) {
  const { Tenant, TenantDatabase, TenantDomain, TenantSubscription } = meta();
  const slug = input.facility.slug;
  if (await Tenant.exists({ slug })) throw conflict('A facility with this slug already exists', undefined, 'TENANT_EXISTS');
  const hosts = [platformSubdomain(slug), ...input.domain.customDomains];
  const taken = await TenantDomain.find({ hostname: { $in: hosts } }).select('hostname').lean();
  if (taken.length) throw conflict('Domain already in use', taken.map((t) => t.hostname), 'DOMAIN_TAKEN');
  const codes = input.branches.map((b) => b.branchCode.toUpperCase());
  if (new Set(codes).size !== codes.length) throw conflict('Branch codes must be unique', undefined, 'BRANCH_CODE_DUPLICATE');

  const dbName = tenantDbName(slug);
  const steps: string[] = [];
  const tenant = await Tenant.create({
    slug,
    name: input.facility.name,
    legalName: input.facility.legalName,
    facilityCode: input.facility.facilityCode,
    registrationNumber: input.facility.registrationNumber,
    facilityLevel: input.facility.facilityLevel,
    facilityType: input.facility.facilityType,
    ownership: input.facility.ownership,
    county: input.facility.county,
    subCounty: input.facility.subCounty,
    phone: input.facility.phone,
    email: input.facility.email || undefined,
    physicalAddress: input.facility.physicalAddress,
    dhaRegistry: input.facility.dhaFacilityRegistryCode ? { facilityRegistryCode: input.facility.dhaFacilityRegistryCode } : undefined,
    integrations: { sha: false, dha: false, mpesa: false, africastalking: false, smtp: false, ...input.integrations },
    status: 'provisioning',
    createdBy: actorId,
  });
  const tenantId = tenant._id;
  steps.push('tenant');
  const conn = getTenantConnection(dbName);
  try {
    const existingDbs = await conn.db!.admin().listDatabases({ nameOnly: true }).catch(() => ({ databases: [] as Array<{ name: string }> }));
    if (existingDbs.databases.some((d) => d.name === dbName)) throw conflict('Tenant database already exists', undefined, 'DATABASE_EXISTS');
    await TenantDatabase.create({ tenantId, dbName, status: 'provisioning' });
    steps.push('database_record');

    const m = tenantModels(conn);
    await ensureTenantIndexes(conn);
    steps.push('database');
    await seedTenantRbac(m);
    steps.push('rbac');

    const branches = [];
    for (const [i, b] of input.branches.entries()) {
      branches.push(await m.Branch.create({ ...b, email: b.email || undefined, branchCode: b.branchCode.toUpperCase(), isMain: i === 0 }));
    }
    steps.push('branches');

    const adminRole = await m.Role.findOne({ key: 'facility_admin' }).lean();
    const ownerRole = await m.Role.findOne({ key: 'facility_owner' }).lean();
    const generated = input.administrator.password || opts.adminPasswordHash ? undefined : `Afs-${randomToken(9)}9a`;
    const admin = await m.User.create({
      name: input.administrator.name,
      email: input.administrator.email.toLowerCase(),
      phone: input.administrator.phone,
      passwordHash: opts.adminPasswordHash ?? (await hashPassword(input.administrator.password ?? generated!)),
      roleIds: [adminRole!._id, ownerRole!._id],
      branchAccess: 'all',
      branchIds: branches.map((b) => b._id),
      defaultBranchId: branches[0]._id,
      mustChangePassword: !opts.adminPasswordHash,
      status: 'active',
    });
    steps.push('admin');

    await TenantDomain.create({ tenantId, hostname: platformSubdomain(slug), type: 'platform_subdomain', verified: true, primary: true });
    for (const host of input.domain.customDomains) {
      await TenantDomain.create({ tenantId, hostname: host, type: 'custom', verified: false, verificationToken: `afeysync-verify=${randomToken(16)}` });
    }
    steps.push('domains');

    await TenantSubscription.create({ tenantId, ...input.subscription, status: input.subscription.plan === 'trial' ? 'trialing' : 'active' });
    steps.push('subscription');

    await m.FacilitySetting.insertMany([
      { key: 'patientNumberPrefix', value: 'AFS' },
      { key: 'sessionTimeoutMinutes', value: 30 },
      { key: 'currency', value: 'KES' },
      { key: 'timezone', value: 'Africa/Nairobi' },
    ]);
    await m.AuditLog.create({ actorType: 'system', action: 'tenant.provisioned', resource: 'tenant', resourceId: String(tenantId), newValue: { slug, branches: branches.length } });

    await seedTenantCatalogs(m);
    await TenantDatabase.updateOne({ tenantId }, { status: 'ready', schemaVersion: TENANT_SCHEMA_VERSION });
    tenant.status = 'active';
    tenant.stats = { branches: branches.length, users: 1, patients: 0, lastActivityAt: new Date() };
    await tenant.save();
    clearDomainCache();
    return {
      tenant,
      dbName,
      admin: { id: String(admin._id), email: admin.email, temporaryPassword: generated },
      branches: branches.map((b) => ({ id: String(b._id), branchName: b.branchName, branchCode: b.branchCode })),
      domains: hosts,
    };
  } catch (err) {
    logger.error({ err, slug, steps }, 'Facility provisioning failed; rolling back');
    // Only resources created in this attempt are rolled back; the database did not exist beforehand.
    if (steps.includes('database_record')) await conn.dropDatabase().catch(() => undefined);
    await Promise.all([
      TenantDatabase.deleteOne({ tenantId }),
      TenantDomain.deleteMany({ tenantId }),
      TenantSubscription.deleteMany({ tenantId }),
      Tenant.deleteOne({ _id: tenantId }),
    ]).catch(() => undefined);
    clearDomainCache();
    throw err;
  }
}

export async function refreshTenantStats(tenantId: string, m: TenantModels) {
  const [branches, users, patients] = await Promise.all([m.Branch.countDocuments({}), m.User.countDocuments({}), m.Patient.countDocuments({})]);
  await meta().Tenant.updateOne({ _id: tenantId }, { 'stats.branches': branches, 'stats.users': users, 'stats.patients': patients, 'stats.lastActivityAt': new Date() });
}
