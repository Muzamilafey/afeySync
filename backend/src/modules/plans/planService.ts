import type { NextFunction, Request, Response } from 'express';
import { meta } from '../../models/meta';
import { AppError } from '../../utils/errors';

/**
 * Module catalog. Core modules are part of every plan (a facility cannot run without registration,
 * OPD and billing). Optional modules are switched on per plan by the platform owner; each maps to the
 * API prefixes it owns, and the backend refuses those routes for facilities whose plan excludes them.
 */
export const CORE_MODULES = ['patients', 'frontdesk', 'opd', 'billing', 'documents', 'administration'] as const;

export const MODULES = {
  laboratory: { label: 'Laboratory', description: 'Test catalog, orders, results and verification', prefixes: ['/laboratory'] },
  radiology: { label: 'Radiology & imaging', description: 'Worklists and imaging reports', prefixes: ['/radiology'] },
  pharmacy: { label: 'Pharmacy & inventory', description: 'Dispensing, stores and stock control', prefixes: ['/pharmacy', '/inventory'] },
  procurement: { label: 'Procurement', description: 'Suppliers, purchase orders and goods received', prefixes: ['/procurement'] },
  inpatient: { label: 'Inpatient & nursing', description: 'Wards, beds, admissions and nursing care', prefixes: ['/inpatient'] },
  maternity: { label: 'Maternity, MCH & FP', description: 'ANC, labour and delivery, immunization, family planning', prefixes: ['/maternity', '/mch', '/family-planning'] },
  dental: { label: 'Dental', description: 'Dental charting and procedures', prefixes: ['/dental'] },
  mortuary: { label: 'Mortuary', description: 'Body management and release', prefixes: ['/mortuary'] },
  finance: { label: 'Finance', description: 'Expenses, cash summary and receivables', prefixes: ['/finance'] },
  hr: { label: 'HR & roster', description: 'Staff records, leave, rosters and licences', prefixes: ['/hr'] },
  reports: { label: 'Reports & analytics', description: 'Clinical, finance and supply reports with export', prefixes: ['/reports'] },
  sha: { label: 'SHA claims', description: 'Eligibility, pre-authorization and eClaims', prefixes: ['/sha'] },
  interop: { label: 'DHA HIE & FHIR', description: 'Client Registry, terminology and shared health records', prefixes: ['/dha', '/fhir'] },
  insurance: { label: 'Private insurance', description: 'Slade360 eligibility, claims and remittances', prefixes: ['/insurance', '/integrations/slade360'] },
  mpesa: { label: 'M-Pesa payments', description: 'STK push, paybill reconciliation and refunds', prefixes: ['/payments/mpesa'] },
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

const ALL: ModuleKey[] = MODULE_KEYS;
const BASIC: ModuleKey[] = ['laboratory', 'pharmacy', 'reports', 'sha', 'mpesa'];
const STANDARD: ModuleKey[] = [...BASIC, 'radiology', 'procurement', 'inpatient', 'maternity', 'finance', 'hr', 'interop', 'insurance'];

/** Starting catalogue. Prices are 0 ("on request") until the owner sets them. */
export const DEFAULT_PLANS = [
  { key: 'trial', name: 'Free trial', description: 'Explore everything, no commitment', trialDays: 30, maxBranches: 2, maxUsers: 15, modules: ALL, features: ['All modules', 'Up to 2 branches, 15 users', '30 days, then choose a plan'], sortOrder: 0 },
  { key: 'basic', name: 'Basic', description: 'Single clinics and dispensaries', trialDays: 30, maxBranches: 1, maxUsers: 20, modules: BASIC, features: ['Front desk, OPD, pharmacy, lab, billing', '1 branch, 20 users', 'SHA claims and M-Pesa'], sortOrder: 1 },
  { key: 'standard', name: 'Standard', description: 'Growing hospitals & medical centres', trialDays: 30, maxBranches: 3, maxUsers: 60, modules: STANDARD, features: ['Radiology, inpatient, maternity', 'Up to 3 branches, 60 users', 'Private insurance and DHA HIE'], highlight: true, sortOrder: 2 },
  { key: 'premium', name: 'Premium', description: 'Multi-branch hospital groups', trialDays: 30, maxBranches: 10, maxUsers: 250, modules: ALL, features: ['Every module', 'Up to 10 branches, 250 users', 'Priority onboarding & support'], sortOrder: 3 },
];

/** Inserts the default plans once; never overwrites what the owner changed. */
export async function seedPlans() {
  const { SubscriptionPlan } = meta();
  for (const p of DEFAULT_PLANS) await SubscriptionPlan.updateOne({ key: p.key }, { $setOnInsert: p }, { upsert: true });
}

export interface Entitlements {
  plan: string;
  planName?: string;
  status: string;
  /** Optional modules available to the facility. */
  modules: ModuleKey[];
  endsAt?: Date | null;
  /** True when the plan key is not in the catalogue (legacy tenants): nothing is restricted. */
  unrestricted: boolean;
}

const cache = new Map<string, { value: Entitlements; exp: number }>();
export function clearEntitlementCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function tenantEntitlements(tenantId: string): Promise<Entitlements> {
  const hit = cache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.value;
  const { TenantSubscription, SubscriptionPlan } = meta();
  const sub = await TenantSubscription.findOne({ tenantId }).sort({ createdAt: -1 }).lean();
  const plan = sub ? await SubscriptionPlan.findOne({ key: sub.plan }).lean() : null;
  const value: Entitlements = plan
    ? { plan: plan.key, planName: plan.name, status: sub!.status, endsAt: sub!.endsAt, modules: (plan.modules ?? []).filter((m): m is ModuleKey => m in MODULES), unrestricted: false }
    : { plan: sub?.plan ?? 'none', status: sub?.status ?? 'active', endsAt: sub?.endsAt, modules: [...MODULE_KEYS], unrestricted: true };
  cache.set(tenantId, { value, exp: Date.now() + 30_000 });
  return value;
}

export function moduleForPath(path: string): ModuleKey | null {
  for (const key of MODULE_KEYS) {
    if (MODULES[key].prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return key;
  }
  return null;
}

/**
 * Refuses facility API calls to modules outside the facility's plan. Mounted on the API router, so
 * `req.path` is relative to /api/v1. Only facility hosts are affected (the owner portal is not).
 */
export async function requirePlanModule(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.hostTenantId) return next();
    const mod = moduleForPath(req.path);
    if (!mod) return next();
    const ent = await tenantEntitlements(req.hostTenantId);
    if (!ent.unrestricted && !ent.modules.includes(mod)) {
      throw new AppError(403, 'MODULE_NOT_IN_PLAN', `${MODULES[mod].label} is not included in your ${ent.planName ?? ent.plan} plan. Upgrade under Administration → Subscription.`);
    }
    next();
  } catch (err) {
    next(err);
  }
}
