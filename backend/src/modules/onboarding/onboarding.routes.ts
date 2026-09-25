import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { h } from '../../utils/asyncHandler';
import { parse, pagination, escapeRegex } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../../utils/errors';
import { randomToken, sha256 } from '../../utils/crypto';
import { meta } from '../../models/meta';
import { authenticatePlatform, requirePermission } from '../../middleware/auth';
import { platformAudit } from '../audit/auditService';
import { notifyEmail } from '../notifications/notify';
import { hashPassword, passwordPolicy } from '../auth/password';
import { platformSubdomain } from '../../middleware/tenantResolver';
import { provisionFacility, type CreateFacilityInput } from '../tenants/provisioning';
import { logger } from '../../utils/logger';

/**
 * Self-service facility onboarding.
 *
 *   applicant: details → email code → submitted ─┬─ owner approves → facility provisioned → sign-in link emailed
 *                                                └─ owner rejects  → reason emailed
 *   (or, when the owner turns on automatic approval, provisioning happens right after the email check)
 *
 * The public endpoints never reveal other applications or facilities beyond "this web address is
 * taken". The applicant tracks their application with a private token returned once.
 */
/** Plans a new facility can choose: the owner's active, public catalogue. */
export async function publicPlans() {
  const plans = await meta().SubscriptionPlan.find({ active: true, public: true }).sort({ sortOrder: 1, name: 1 }).lean();
  return plans.map((p) => ({ key: p.key, name: p.name, description: p.description, currency: p.currency, prices: p.prices, setupFee: p.setupFee, maxBranches: p.maxBranches, maxUsers: p.maxUsers, trialDays: p.trialDays, modules: p.modules, features: p.features, highlight: p.highlight }));
}
async function planFor(key: string | null | undefined) {
  const plan = await meta().SubscriptionPlan.findOne({ key: key ?? 'trial', active: true }).lean();
  if (!plan) throw badRequest('This plan is no longer available. Choose another plan.');
  return plan;
}

export const INTERESTS = ['sha', 'dha', 'mpesa', 'sms', 'insurance', 'laboratory', 'pharmacy', 'inpatient', 'maternity', 'radiology'] as const;

/** Names that can never be a facility web address. */
const RESERVED = new Set(['www', 'owner', 'api', 'admin', 'app', 'mail', 'smtp', 'support', 'help', 'status', 'docs', 'static', 'cdn', 'assets', 'login', 'signup', 'get-started', 'onboarding', 'billing', 'afeysync', 'dashboard', 'test', 'demo', 'root', 'system']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const RESEND_SECONDS = 30;
const UNVERIFIED_TTL_MS = 48 * 3600_000;

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/** The facility's sign-in address, built from the platform's public URL scheme and port. */
export function facilityLoginUrl(slug: string) {
  const u = new URL(env.FRONTEND_URL);
  return `${u.protocol}//${platformSubdomain(slug)}${u.port ? `:${u.port}` : ''}/login`;
}

async function approvalMode(): Promise<'manual' | 'automatic'> {
  const s = await meta().PlatformSettings.findOne({ key: 'onboarding' }).lean();
  return (s?.value as { approvalMode?: string } | undefined)?.approvalMode === 'automatic' ? 'automatic' : 'manual';
}

/** Returns null when the address can be used, otherwise the reason. */
async function slugProblem(slug: string): Promise<string | null> {
  if (!SLUG_RE.test(slug)) return 'Use 3–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.';
  if (RESERVED.has(slug)) return 'This address is reserved.';
  const { Tenant, TenantDomain, FacilityApplication } = meta();
  const [tenant, domain, app] = await Promise.all([
    Tenant.exists({ slug }),
    TenantDomain.exists({ hostname: platformSubdomain(slug) }),
    FacilityApplication.exists({ slug, status: 'submitted' }),
  ]);
  return tenant || domain || app ? 'This address is already taken.' : null;
}

async function suggestSlug(base: string) {
  const root = slugify(base) || 'facility';
  for (const candidate of [root, `${root}-hospital`, `${root}-health`, ...Array.from({ length: 5 }, () => `${root}-${crypto.randomInt(10, 99)}`)]) {
    const c = candidate.slice(0, 40).replace(/-+$/, '');
    if (!(await slugProblem(c))) return c;
  }
  return null;
}

const maskEmail = (e: string) => e.replace(/^(.)(.*)(.@.*)$/, (_m, a: string, mid: string, b: string) => `${a}${'*'.repeat(Math.min(6, mid.length))}${b}`);

async function sendCode(app: InstanceType<ReturnType<typeof meta>['FacilityApplication']>) {
  const v: { sends?: number | null; sentAt?: Date | null } = app.verification ?? {};
  if ((v.sends ?? 0) >= MAX_SENDS) throw new AppError(429, 'ONBOARDING_SEND_LIMIT', 'Too many codes requested. Start a new application later.');
  if (v.sentAt && Date.now() - v.sentAt.getTime() < RESEND_SECONDS * 1000) throw new AppError(429, 'ONBOARDING_RESEND_TOO_SOON', `Wait ${RESEND_SECONDS} seconds before requesting another code.`);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  app.set('verification', { codeHash: sha256(`${app._id}:${code}`), sentAt: new Date(), sends: (v.sends ?? 0) + 1, attempts: 0 });
  await app.save();
  // Sensitive: the queued copy is encrypted and wiped after sending, so the code is never stored in plain text.
  await notifyEmail(null, `onboarding:${app._id}:${(v.sends ?? 0) + 1}`, app.admin!.email!, 'Your AfeySync verification code', `Your AfeySync verification code is ${code}. It expires in 15 minutes.\n\nYou are registering ${app.facility?.name} (${app.reference}). If you did not start this registration, ignore this email.`, undefined, {
    sensitive: true,
    code: { value: code, expires: '15 minutes' },
    title: 'Confirm your AfeySync registration',
    intro: `Enter this code to confirm the registration of ${app.facility?.name ?? 'your facility'} (${app.reference}).`,
    notice: "Didn't start this registration? You can ignore this email.",
  });
  return maskEmail(app.admin!.email!);
}

async function findByToken(token: string) {
  const app = await meta().FacilityApplication.findOne({ tokenHash: sha256(`onb:${token}`) }).select('+verification.codeHash +admin.passwordHash');
  if (!app) throw unauthorized('This registration link is no longer valid. Start again.', 'ONBOARDING_TOKEN_INVALID');
  return app;
}

type App = Awaited<ReturnType<typeof findByToken>>;

const publicView = (app: App) => ({
  reference: app.reference,
  status: app.status,
  facilityName: app.facility?.name,
  slug: app.slug,
  address: platformSubdomain(app.slug),
  plan: app.plan,
  email: maskEmail(app.admin?.email ?? ''),
  submittedAt: app.submittedAt,
  rejectionReason: app.status === 'rejected' ? app.rejectionReason : undefined,
  loginUrl: app.status === 'approved' ? facilityLoginUrl(app.slug) : undefined,
});

/** Builds the provisioning input from an application. The facility starts on a 30-day trial of the chosen tier's limits. */
function toProvisioningInput(app: App, plan: { key: string; maxBranches: number; maxUsers: number; trialDays: number }): CreateFacilityInput {
  const f = app.facility ?? {};
  const interests = new Set(app.interests ?? []);
  const branches = (app.branches ?? []).map((b) => ({ branchName: b.branchName!, branchCode: b.branchCode!, county: b.county ?? undefined, subCounty: b.subCounty ?? undefined, physicalAddress: b.physicalAddress ?? undefined, phone: b.phone ?? undefined, facilityLevel: f.facilityLevel ?? undefined, facilityType: f.facilityType ?? undefined }));
  if (branches.length && f.bedCapacity) Object.assign(branches[0], { bedCapacity: f.bedCapacity });
  const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as T;
  return {
    facility: clean({ name: f.name!, slug: app.slug, legalName: f.legalName ?? undefined, facilityCode: f.facilityCode ?? undefined, registrationNumber: f.registrationNumber ?? undefined, facilityLevel: f.facilityLevel ?? undefined, facilityType: f.facilityType ?? undefined, ownership: f.ownership ?? undefined, county: f.county ?? undefined, subCounty: f.subCounty ?? undefined, phone: f.phone ?? undefined, email: f.email ?? undefined, physicalAddress: f.physicalAddress ?? undefined, dhaFacilityRegistryCode: f.dhaFacilityRegistryCode ?? undefined }),
    administrator: clean({ name: app.admin!.name!, email: app.admin!.email!, phone: app.admin?.phone ?? undefined }),
    domain: { customDomains: [] },
    branches,
    integrations: { sha: interests.has('sha'), dha: interests.has('sha') || interests.has('dha'), mpesa: interests.has('mpesa'), africastalking: interests.has('sms'), talksasa: interests.has('sms'), slade360: interests.has('insurance') },
    // The chosen plan's modules and limits apply from day one; the first period is a free trial when the plan offers one.
    subscription: { plan: plan.key, status: plan.trialDays > 0 ? 'trialing' : 'active', billingCycle: 'monthly', amount: 0, maxBranches: Math.max(plan.maxBranches, branches.length), maxUsers: plan.maxUsers, endsAt: plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86_400_000) : undefined },
  };
}

/** Provisions an approved application. On failure the application stays `submitted` with the error recorded. */
async function approve(app: App, reviewer: { id?: string; name?: string } | null, req: Request | null) {
  if (app.status !== 'submitted') throw conflict(`This application is ${app.status.replace('_', ' ')}`, undefined, 'INVALID_TRANSITION');
  const problem = await meta().Tenant.exists({ slug: app.slug });
  if (problem) throw conflict('A facility with this web address already exists', undefined, 'TENANT_EXISTS');
  let result;
  try {
    result = await provisionFacility(toProvisioningInput(app, await planFor(app.plan)), reviewer?.id, { adminPasswordHash: app.admin?.passwordHash ?? undefined });
  } catch (err) {
    app.provisioningError = (err as Error).message.slice(0, 300);
    await app.save();
    logger.error({ err, ref: app.reference }, 'onboarding provisioning failed');
    throw err;
  }
  app.set({ status: 'approved', tenantId: result.tenant._id, reviewedBy: reviewer?.id, reviewedByName: reviewer?.name ?? 'Automatic approval', reviewedAt: new Date(), autoApproved: !reviewer, provisioningError: undefined });
  // The password hash has served its purpose; it now lives only in the facility's own database.
  app.set('admin.passwordHash', undefined);
  await app.save();
  await platformAudit(req, { action: 'onboarding.approve', resource: 'facility_application', resourceId: String(app._id), tenantId: String(result.tenant._id), newValue: { reference: app.reference, slug: app.slug, automatic: !reviewer } });
  const url = facilityLoginUrl(app.slug);
  await notifyEmail(null, `onboarding-approved:${app._id}`, app.admin!.email!, `${app.facility?.name} is ready on AfeySync`, `Welcome to AfeySync!\n\n${app.facility?.name} has been set up. Sign in at:\n${url}\n\nUse ${app.admin!.email} and the password you chose during registration. Your 30-day trial has started.\n\nNext steps: add your staff (Users & Roles), set your service prices (Services & Prices) and turn on two-step verification (Account → Security).`);
  return { tenantId: String(result.tenant._id), loginUrl: url };
}

/* ================================================================== Public */
export const onboardingPublicRouter = Router();

onboardingPublicRouter.get('/onboarding/config', h(async (_req, res) => {
  res.json({ success: true, data: { platformDomain: env.PLATFORM_DOMAIN, approvalMode: await approvalMode(), plans: await publicPlans(), interests: INTERESTS } });
}));

onboardingPublicRouter.get('/onboarding/slug', h(async (req, res) => {
  const q = parse(z.object({ slug: z.string().max(60).optional(), name: z.string().max(160).optional() }), req.query);
  const slug = q.slug ? q.slug.toLowerCase() : slugify(q.name ?? '');
  const problem = slug ? await slugProblem(slug) : 'Enter a web address';
  res.json({ success: true, data: { slug, address: slug ? platformSubdomain(slug) : null, available: !problem, reason: problem, suggestion: problem ? await suggestSlug(q.name || slug) : null } });
}));

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const applicationSchema = z.object({
  facility: z.object({
    name: z.string().trim().min(3, 'Enter the facility name').max(160),
    legalName: optionalText(200),
    facilityType: z.string().trim().min(2, 'Choose the facility type').max(60),
    facilityLevel: optionalText(40),
    ownership: optionalText(60),
    facilityCode: optionalText(40),
    registrationNumber: optionalText(60),
    county: z.string().trim().min(2, 'Choose the county').max(60),
    subCounty: optionalText(60),
    physicalAddress: optionalText(300),
    phone: z.string().trim().min(9, 'Enter a phone number').max(30),
    email: z.string().trim().email().optional().or(z.literal('').transform(() => undefined)),
    bedCapacity: z.number().int().min(0).max(5000).optional(),
  }),
  slug: z.string().toLowerCase(),
  branches: z.array(z.object({ branchName: z.string().trim().min(2).max(120), branchCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Branch codes use 2–20 letters, digits or hyphens'), county: optionalText(60), subCounty: optionalText(60), physicalAddress: optionalText(300), phone: optionalText(30) })).min(1).max(10),
  admin: z.object({ name: z.string().trim().min(3).max(120), email: z.string().trim().toLowerCase().email(), phone: z.string().trim().min(9).max(30), jobTitle: optionalText(80), password: passwordPolicy }),
  plan: z.string().trim().max(40).default('trial'),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  expectedUsers: z.number().int().min(1).max(5000).optional(),
  heardFrom: optionalText(120),
  notes: optionalText(1000),
  acceptTerms: z.literal(true, { message: 'You must accept the terms to continue' }),
});

onboardingPublicRouter.post('/onboarding/applications', h(async (req, res) => {
  const body = parse(applicationSchema, req.body);
  const problem = await slugProblem(body.slug);
  if (problem) throw conflict(problem, undefined, 'SLUG_UNAVAILABLE');
  if (!(await meta().SubscriptionPlan.exists({ key: body.plan, active: true, public: true }))) throw badRequest('Choose one of the available plans');
  const codes = body.branches.map((b) => b.branchCode);
  if (new Set(codes).size !== codes.length) throw badRequest('Branch codes must be unique');
  const { FacilityApplication } = meta();
  if (await FacilityApplication.exists({ 'admin.email': body.admin.email, status: 'submitted' })) throw conflict('An application with this email is already being reviewed. We will email you the outcome.', undefined, 'APPLICATION_PENDING');
  // Replace any earlier unverified attempt by the same person for the same address.
  await FacilityApplication.deleteMany({ 'admin.email': body.admin.email, slug: body.slug, status: 'email_pending' });
  const token = randomToken(32);
  const app = await FacilityApplication.create({
    reference: `APP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    tokenHash: sha256(`onb:${token}`),
    slug: body.slug,
    facility: body.facility,
    branches: body.branches,
    admin: { name: body.admin.name, email: body.admin.email, phone: body.admin.phone, jobTitle: body.admin.jobTitle, passwordHash: await hashPassword(body.admin.password) },
    plan: body.plan,
    interests: body.interests,
    expectedUsers: body.expectedUsers,
    heardFrom: body.heardFrom,
    notes: body.notes,
    termsAcceptedAt: new Date(),
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 300),
    expiresAt: new Date(Date.now() + UNVERIFIED_TTL_MS),
  });
  const sentTo = await sendCode(app as App);
  res.status(201).json({ success: true, data: { applicationToken: token, reference: app.reference, sentTo } });
}));

onboardingPublicRouter.post('/onboarding/applications/resend', h(async (req, res) => {
  const { applicationToken } = parse(z.object({ applicationToken: z.string().min(20).max(200) }), req.body);
  const app = await findByToken(applicationToken);
  if (app.status !== 'email_pending') throw conflict('Your email is already confirmed', undefined, 'ALREADY_VERIFIED');
  res.json({ success: true, data: { sentTo: await sendCode(app) } });
}));

onboardingPublicRouter.post('/onboarding/applications/verify', h(async (req, res) => {
  const body = parse(z.object({ applicationToken: z.string().min(20).max(200), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
  const app = await findByToken(body.applicationToken);
  if (app.status !== 'email_pending') return res.json({ success: true, data: publicView(app) });
  const v = app.verification;
  if (!v?.codeHash || !v.sentAt || Date.now() - v.sentAt.getTime() > CODE_TTL_MS) throw new AppError(401, 'ONBOARDING_CODE_EXPIRED', 'This code has expired. Request a new one.');
  if ((v.attempts ?? 0) >= MAX_ATTEMPTS) throw new AppError(429, 'ONBOARDING_TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Request a new code.');
  if (!crypto.timingSafeEqual(Buffer.from(v.codeHash), Buffer.from(sha256(`${app._id}:${body.code}`)))) {
    const attempts = (v.attempts ?? 0) + 1;
    app.set('verification.attempts', attempts);
    await app.save();
    const left = MAX_ATTEMPTS - attempts;
    throw new AppError(401, 'ONBOARDING_CODE_INVALID', left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many incorrect codes. Request a new code.');
  }
  // The address may have been taken while the applicant was reading their email.
  const problem = await slugProblem(app.slug);
  if (problem) throw conflict(`${problem} Start again with another web address.`, undefined, 'SLUG_UNAVAILABLE');
  app.set({ status: 'submitted', submittedAt: new Date(), 'verification.verifiedAt': new Date(), 'verification.codeHash': undefined, expiresAt: undefined });
  await app.save();
  await platformAudit(null, { action: 'onboarding.submitted', resource: 'facility_application', resourceId: String(app._id), newValue: { reference: app.reference, slug: app.slug, facility: app.facility?.name } });

  if ((await approvalMode()) === 'automatic') {
    try {
      await approve(app, null, null);
    } catch {
      /* stays submitted for manual review; the owner sees the provisioning error */
    }
  } else {
    await notifyEmail(null, `onboarding-received:${app._id}`, app.admin!.email!, `We received your AfeySync registration (${app.reference})`, `Thank you for registering ${app.facility?.name}.\n\nOur team will review your application and email you when your facility is ready, usually within one working day. Reference: ${app.reference}.`);
    const owners = await meta().PlatformUser.find({ status: 'active', role: { $in: ['super_owner', 'platform_admin'] } }).select('email').lean();
    for (const o of owners) await notifyEmail(null, `onboarding-new:${app._id}:${o._id}`, o.email, `New facility registration: ${app.facility?.name}`, `${app.facility?.name} (${app.facility?.county}) applied for ${platformSubdomain(app.slug)} on the ${app.plan} plan. Review it in the Owner Portal → Registrations. Reference ${app.reference}.`);
  }
  res.json({ success: true, data: publicView(app) });
}));

onboardingPublicRouter.post('/onboarding/applications/status', h(async (req, res) => {
  const { applicationToken } = parse(z.object({ applicationToken: z.string().min(20).max(200) }), req.body);
  res.json({ success: true, data: publicView(await findByToken(applicationToken)) });
}));

/* ================================================================== Owner review */
export const onboardingOwnerRouter = Router();
onboardingOwnerRouter.use(authenticatePlatform);

onboardingOwnerRouter.get('/settings', requirePermission('owner.tenants'), h(async (_req, res) => {
  res.json({ success: true, data: { approvalMode: await approvalMode() } });
}));
onboardingOwnerRouter.put('/settings', requirePermission('owner.platform'), h(async (req, res) => {
  const body = parse(z.object({ approvalMode: z.enum(['manual', 'automatic']) }), req.body);
  const before = await approvalMode();
  await meta().PlatformSettings.updateOne({ key: 'onboarding' }, { $set: { key: 'onboarding', value: body } }, { upsert: true });
  await platformAudit(req, { action: 'onboarding.settings', resource: 'platform_settings', resourceId: 'onboarding', oldValue: { approvalMode: before }, newValue: body });
  res.json({ success: true, data: body });
}));

onboardingOwnerRouter.get('/applications', requirePermission('owner.tenants'), h(async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter: Record<string, unknown> = { status: { $ne: 'email_pending' } };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) {
    const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [{ 'facility.name': re }, { slug: re }, { reference: re }, { 'admin.email': re }];
  }
  const { FacilityApplication } = meta();
  const [rows, total, pending] = await Promise.all([
    FacilityApplication.find(filter).sort({ submittedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    FacilityApplication.countDocuments(filter),
    FacilityApplication.countDocuments({ status: 'submitted' }),
  ]);
  res.json({ success: true, data: rows.map((r) => ({ ...r, address: platformSubdomain(r.slug) })), meta: { page, limit, total, pending } });
}));

async function loadForReview(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw notFound('Application not found');
  const app = await meta().FacilityApplication.findById(id).select('+admin.passwordHash');
  if (!app || app.status === 'email_pending') throw notFound('Application not found');
  return app as App;
}

onboardingOwnerRouter.post('/applications/:id/approve', requirePermission('owner.tenants'), h(async (req, res) => {
  const app = await loadForReview(String(req.params.id));
  const body = parse(z.object({ plan: z.string().trim().max(40).optional() }), req.body ?? {});
  if (body.plan) app.plan = (await planFor(body.plan)).key;
  const r = await approve(app, { id: req.platformUser!.id, name: req.platformUser!.name }, req);
  res.json({ success: true, data: { ...r, reference: app.reference } });
}));

onboardingOwnerRouter.post('/applications/:id/reject', requirePermission('owner.tenants'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give the applicant a reason').max(500) }), req.body);
  const app = await loadForReview(String(req.params.id));
  if (app.status !== 'submitted') throw conflict(`This application is ${app.status}`, undefined, 'INVALID_TRANSITION');
  app.set({ status: 'rejected', rejectionReason: reason, reviewedBy: req.platformUser!.id, reviewedByName: req.platformUser!.name, reviewedAt: new Date() });
  app.set('admin.passwordHash', undefined);
  await app.save();
  await platformAudit(req, { action: 'onboarding.reject', resource: 'facility_application', resourceId: String(app._id), newValue: { reference: app.reference, reason } });
  await notifyEmail(null, `onboarding-rejected:${app._id}`, app.admin!.email!, `Your AfeySync registration (${app.reference})`, `Thank you for your interest in AfeySync. We could not approve the registration for ${app.facility?.name} at this time.\n\nReason: ${reason}\n\nYou are welcome to reply to this email or register again.`);
  res.json({ success: true, data: { status: app.status } });
}));
