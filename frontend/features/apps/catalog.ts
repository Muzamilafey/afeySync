import {
  Baby, Banknote, BarChart3, BedDouble, Boxes, Briefcase, Building2, CalendarDays, ClipboardList, CreditCard, Cross, FileSearch,
  FlaskConical, HeartHandshake, HeartPulse, IdCard, LayoutDashboard, ListOrdered, MessageSquareText, Network, Palette, Pill, Receipt,
  ScanLine, Send, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Smile, Stethoscope, Umbrella, UserPlus, Users, Wallet, Warehouse,
  type LucideIcon,
} from 'lucide-react';

/** A page inside an app. `any`: at least one of these permissions is needed to see it. */
export interface AppItem { href: string; label: string; icon: LucideIcon; any?: string[]; module?: string }
/** An app on the launcher: a group of related pages with its own menu. */
export interface AppDef {
  key: string;
  name: string;
  /** What the app covers, shown under its name on the card (e.g. "Visits, Patients, Queues"). */
  summary: string;
  icon: LucideIcon;
  group: (typeof APP_GROUPS)[number];
  items: AppItem[];
  /** Other paths that belong to this app (detail pages opened from it). */
  match?: string[];
}

export const APP_GROUPS = ['Front Office', 'Clinical', 'Diagnostics', 'Pharmacy & Stores', 'Finance', 'Claims & Insurance', 'Communication', 'Administration'] as const;

/**
 * Every facility app. Each page is filtered by the user's permissions and the facility's plan, and an app
 * appears only when at least one of its pages is available. The API enforces the same rules.
 */
export const APPS: AppDef[] = [
  {
    key: 'frontdesk', name: 'Front Desk', summary: 'Visits, Patients, Queues, Appointments', icon: ClipboardList, group: 'Front Office',
    items: [
      { href: '/frontdesk', label: 'Front desk', icon: UserPlus, any: ['patients.create', 'frontdesk.view'] },
      { href: '/patients', label: 'Patients', icon: Users, any: ['patients.search', 'patients.view'] },
      { href: '/appointments', label: 'Appointments', icon: CalendarDays, any: ['appointments.view'] },
    ],
  },
  {
    key: 'outpatient', name: 'Outpatient (OPD)', summary: 'Triage, Consultation, Orders, Prescriptions', icon: Stethoscope, group: 'Clinical',
    items: [
      { href: '/queue/triage', label: 'Triage queue', icon: ListOrdered, any: ['opd.create'] },
      { href: '/queue/consultation', label: 'Consultation queue', icon: Stethoscope, any: ['consultation.create'] },
    ],
    match: ['/visits', '/queue'],
  },
  {
    key: 'inpatient', name: 'Inpatient', summary: 'Admissions, Wards, Nursing, Discharge', icon: BedDouble, group: 'Clinical',
    items: [{ href: '/inpatient', label: 'Admissions & wards', icon: BedDouble, any: ['inpatient.view', 'nursing.view'], module: 'inpatient' }],
  },
  {
    key: 'maternity', name: 'Maternity & MCH', summary: 'Antenatal, Labour, Delivery, Child health, Family planning', icon: Baby, group: 'Clinical',
    items: [
      { href: '/maternity', label: 'Maternity', icon: Baby, any: ['maternity.view'], module: 'maternity' },
      { href: '/mch', label: 'MCH / FP', icon: HeartHandshake, any: ['mch.view', 'fp.view'], module: 'maternity' },
    ],
  },
  {
    key: 'dental', name: 'Dental', summary: 'Dental chart, Procedures, Treatment plans', icon: Smile, group: 'Clinical',
    items: [{ href: '/dental', label: 'Dental clinic', icon: Smile, any: ['dental.view'], module: 'dental' }],
  },
  {
    key: 'mortuary', name: 'Mortuary', summary: 'Admissions, Storage, Release', icon: Cross, group: 'Clinical',
    items: [{ href: '/mortuary', label: 'Mortuary', icon: Cross, any: ['mortuary.view'], module: 'mortuary' }],
  },
  {
    key: 'laboratory', name: 'Laboratory', summary: 'Worklist, Walk-in requests, Results, Test catalogue', icon: FlaskConical, group: 'Diagnostics',
    items: [
      { href: '/laboratory', label: 'Lab worklist', icon: FlaskConical, any: ['lab.view'], module: 'laboratory' },
      { href: '/laboratory/tests', label: 'Tests & packages', icon: ClipboardList, any: ['lab.manage'], module: 'laboratory' },
    ],
  },
  {
    key: 'radiology', name: 'Radiology', summary: 'Imaging requests, Reports, Results', icon: ScanLine, group: 'Diagnostics',
    items: [{ href: '/radiology', label: 'Imaging worklist', icon: ScanLine, any: ['radiology.view'], module: 'radiology' }],
  },
  {
    key: 'pharmacy', name: 'Pharmacy', summary: 'Dispensing, Ward & discharge drugs, POS, Z-report', icon: Pill, group: 'Pharmacy & Stores',
    items: [
      { href: '/pharmacy', label: 'Dispensing', icon: Pill, any: ['pharmacy.view'], module: 'pharmacy' },
      { href: '/pharmacy/pos', label: 'Pharmacy POS', icon: ShoppingBag, any: ['pharmacy.sell'], module: 'pharmacy' },
    ],
  },
  {
    key: 'stores', name: 'Inventory & Stores', summary: 'Stock, Requisitions, Stock take, Purchase orders', icon: Boxes, group: 'Pharmacy & Stores',
    items: [
      { href: '/inventory', label: 'Inventory', icon: Boxes, any: ['inventory.view', 'pharmacy.stock', 'pharmacy.view'], module: 'pharmacy' },
      { href: '/inventory/stores', label: 'Stores & requisitions', icon: Warehouse, any: ['inventory.view', 'inventory.manage', 'pharmacy.stock', 'pharmacy.dispense', 'nursing.record', 'lab.sample', 'lab.manage', 'dental.manage', 'radiology.manage'], module: 'pharmacy' },
      { href: '/procurement', label: 'Procurement', icon: ShoppingCart, any: ['procurement.view'], module: 'procurement' },
    ],
  },
  {
    key: 'billing', name: 'Billing & Cashier', summary: 'Invoices, Payments, M-Pesa, Price lists, Schemes', icon: Banknote, group: 'Finance',
    items: [
      { href: '/billing', label: 'Cashier', icon: Banknote, any: ['billing.view'] },
      { href: '/billing/services', label: 'Services & prices', icon: Receipt, any: ['billing.prices'] },
      { href: '/billing/schemes', label: 'Corporates & schemes', icon: Briefcase, any: ['billing.prices', 'billing.view', 'insurance.view'] },
      { href: '/billing/reconciliation', label: 'Reconciliation', icon: ClipboardList, any: ['billing.view'] },
    ],
  },
  {
    key: 'finance', name: 'Finance', summary: 'Expenses, Collections, Accounts', icon: Wallet, group: 'Finance',
    items: [{ href: '/finance', label: 'Finance', icon: Wallet, any: ['finance.view'], module: 'finance' }],
  },
  {
    key: 'analytics', name: 'Reports & Analytics', summary: 'Dashboard, Reports, Exports', icon: BarChart3, group: 'Finance',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/reports', label: 'Reports', icon: BarChart3, any: ['reports.view'], module: 'reports' },
    ],
  },
  {
    key: 'sha', name: 'SHA', summary: 'Eligibility, SHA visits, Claims, Interoperability', icon: ShieldCheck, group: 'Claims & Insurance',
    items: [
      { href: '/sha', label: 'SHA overview', icon: ShieldCheck, any: ['sha.view', 'sha.eligibility'], module: 'sha' },
      { href: '/sha/visits', label: 'SHA visits', icon: Stethoscope, any: ['sha.view', 'sha.authorization'], module: 'sha' },
      { href: '/sha/claims', label: 'SHA claims', icon: ClipboardList, any: ['sha.view'], module: 'sha' },
      { href: '/interop', label: 'Interoperability', icon: Network, any: ['dha.view', 'sha.view', 'dha.fhir', 'dha.terminology'], module: 'interop' },
    ],
    match: ['/sha/transactions'],
  },
  {
    key: 'insurance', name: 'Private Insurance', summary: 'Coverage, Claims, Remittances, Payers', icon: Umbrella, group: 'Claims & Insurance',
    items: [
      { href: '/insurance', label: 'Insurance', icon: Umbrella, any: ['insurance.view'], module: 'insurance' },
      { href: '/insurance/claims', label: 'Claims', icon: ClipboardList, any: ['insurance.view'], module: 'insurance' },
      { href: '/insurance/remittances', label: 'Remittances', icon: Wallet, any: ['insurance.view'], module: 'insurance' },
      { href: '/insurance/payers', label: 'Payers', icon: Building2, any: ['insurance.view'], module: 'insurance' },
    ],
  },
  {
    key: 'communication', name: 'Client Communication', summary: 'Bulk SMS, Campaigns, SMS wallet', icon: MessageSquareText, group: 'Communication',
    items: [
      { href: '/sms', label: 'Bulk SMS', icon: Send, any: ['sms.bulk'] },
      { href: '/admin/sms', label: 'SMS wallet', icon: MessageSquareText, any: ['subscription.view', 'admin.settings'] },
    ],
  },
  {
    key: 'hr', name: 'HR & Roster', summary: 'Staff records, Leave, Duty roster', icon: IdCard, group: 'Administration',
    items: [{ href: '/hr', label: 'HR & roster', icon: IdCard, any: ['hr.view'], module: 'hr' }],
  },
  {
    key: 'administration', name: 'Administration', summary: 'Users & roles, Branches, Integrations, Branding, Audit', icon: Settings, group: 'Administration',
    items: [
      { href: '/admin/users', label: 'Users & roles', icon: Users, any: ['admin.users', 'admin.roles'] },
      { href: '/admin/branches', label: 'Branches', icon: Building2, any: ['admin.branches'] },
      { href: '/admin/integrations', label: 'Integrations', icon: HeartPulse, any: ['admin.integrations'] },
      { href: '/admin/branding', label: 'Branding', icon: Palette, any: ['admin.settings'] },
      { href: '/admin/diagnoses', label: 'Diagnoses', icon: ClipboardList, any: ['admin.settings'] },
      { href: '/admin/security', label: 'Security', icon: ShieldCheck, any: ['admin.support_access', 'admin.settings'] },
      { href: '/admin/audit', label: 'Audit trail', icon: FileSearch, any: ['admin.audit'] },
      { href: '/admin/subscription', label: 'Subscription', icon: CreditCard, any: ['subscription.view'] },
    ],
  },
];

export interface Access { perms: Set<string>; modules: string[] | null }

/** The apps (and pages within them) this user may open. */
export function visibleApps(a: Access): AppDef[] {
  const ok = (i: AppItem) => (!i.any || i.any.some((p) => a.perms.has(p))) && (!i.module || !a.modules || a.modules.includes(i.module));
  return APPS.map((app) => ({ ...app, items: app.items.filter(ok) })).filter((app) => app.items.length > 0);
}

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** The app a path belongs to, and the page inside it (the most specific match wins). */
export function appForPath(apps: AppDef[], path: string): { app: AppDef; item?: AppItem } | null {
  let best: { app: AppDef; item?: AppItem; len: number } | null = null;
  for (const app of apps) {
    for (const item of app.items) if (under(path, item.href) && (!best || item.href.length > best.len)) best = { app, item, len: item.href.length };
    for (const m of app.match ?? []) if (under(path, m) && (!best || m.length > best.len)) best = { app, item: undefined, len: m.length };
  }
  return best ? { app: best.app, item: best.item } : null;
}
