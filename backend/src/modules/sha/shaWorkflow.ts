import { AppError } from '../../utils/errors';

/**
 * SHA workflow decision engine. It never applies local rules about which services need preauthorization:
 * every decision comes from the flags DHA returns for the intervention (Benefit Interventions API).
 */
type Obj = Record<string, unknown>;

const PREAUTH_SPECIALTIES = ['requiresSurgicalPreauth', 'requiresRadiologyPreauth', 'requiresOpticalPreauth', 'requiresOncologyPreauth', 'requiresRenalPreauth'] as const;

const val = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const bool = (o: Obj, ...keys: string[]) => {
  const v = val(o, ...keys);
  return typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : undefined;
};
const strs = (o: Obj, ...keys: string[]) => {
  const v = val(o, ...keys);
  return Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? String((x as Obj).name ?? (x as Obj).code ?? JSON.stringify(x)) : String(x))) : [];
};
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export interface InterventionFlags {
  code: string;
  name?: string;
  paymentMechanism?: string;
  accessPoint?: string;
  fund?: string;
  needsPreauth?: boolean;
  needsManualPreauthApproval?: boolean;
  needsDoctorAuthorization?: boolean;
  needsMemberAuthorization?: boolean;
  needApprovalBeforeClaimSubmission?: boolean;
  specialPreauth: string[];
  requiredPreauthDocumentTypes: string[];
  optionalPreauthDocumentTypes: string[];
  applicableDocumentTypes: string[];
  optionalDocumentTypes: string[];
  status?: string;
  coverageLevel?: string;
  raw: Obj;
}

/** Reads the documented flags (camelCase, with snake_case fallbacks) without reinterpreting them. */
export function interventionFlags(raw: Obj): InterventionFlags {
  const g = (k: string) => val(raw, k, snake(k));
  const b = (k: string) => bool(raw, k, snake(k));
  const l = (k: string) => strs(raw, k, snake(k));
  return {
    code: String(val(raw, 'code', 'interventionCode', 'intervention_code') ?? ''),
    name: val(raw, 'name', 'interventionName', 'intervention_name') as string | undefined,
    paymentMechanism: g('paymentMechanism') as string | undefined,
    accessPoint: g('accessPoint') as string | undefined,
    fund: g('fund') as string | undefined,
    needsPreauth: b('needsPreauth'),
    needsManualPreauthApproval: b('needsManualPreauthApproval'),
    needsDoctorAuthorization: b('needsDoctorAuthorization'),
    needsMemberAuthorization: b('needsMemberAuthorization'),
    needApprovalBeforeClaimSubmission: b('needApprovalBeforeClaimSubmission'),
    specialPreauth: PREAUTH_SPECIALTIES.filter((k) => b(k)).map((k) => k.replace(/^requires|Preauth$/g, '').toLowerCase()),
    requiredPreauthDocumentTypes: l('requiredPreauthDocumentTypes'),
    optionalPreauthDocumentTypes: l('optionalPreauthDocumentTypes'),
    applicableDocumentTypes: l('applicableDocumentTypes'),
    optionalDocumentTypes: l('optionalDocumentTypes'),
    status: g('status') as string | undefined,
    coverageLevel: g('coverageLevel') as string | undefined,
    raw,
  };
}

export interface WorkflowDecision {
  serviceType: 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CAPITATION';
  needsPreauth: boolean;
  manualApproval: boolean;
  preauthInterventions: string[];
  specialPreauth: string[];
  requiredDocuments: string[];
  paymentMechanisms: string[];
  accessPoints: string[];
  funds: string[];
  steps: string[];
  warnings: string[];
}

/** Determines the applicable SHA workflow for the selected interventions from DHA's flags. */
export function decideWorkflow(interventions: InterventionFlags[], opts: { emergency?: boolean } = {}): WorkflowDecision {
  const uniq = (xs: Array<string | undefined>) => [...new Set(xs.filter(Boolean) as string[])];
  const accessPoints = uniq(interventions.map((i) => i.accessPoint));
  const paymentMechanisms = uniq(interventions.map((i) => i.paymentMechanism));
  const preauth = interventions.filter((i) => i.needsPreauth === true);
  const warnings: string[] = [];
  if (accessPoints.length > 1) warnings.push(`Selected interventions span access points ${accessPoints.join(' and ')}; start separate visits or switch interventions.`);
  for (const i of interventions) if (i.needsPreauth === undefined) warnings.push(`DHA did not return needsPreauth for ${i.code}; confirm before proceeding.`);
  for (const i of interventions) if (i.status && !/active/i.test(i.status)) warnings.push(`Intervention ${i.code} status is ${i.status}.`);
  const serviceType: WorkflowDecision['serviceType'] = opts.emergency ? 'EMERGENCY' : paymentMechanisms.length === 1 && paymentMechanisms[0] === 'CAPITATION' ? 'CAPITATION' : accessPoints.includes('IP') ? 'INPATIENT' : 'OUTPATIENT';
  const steps = ['consent', 'start_visit'];
  if (preauth.length) steps.push(preauth.some((i) => i.needsManualPreauthApproval) ? 'preauthorization_manual_approval' : 'preauthorization');
  steps.push('diagnoses', 'interventions', 'billable_items', 'documents', 'preview', serviceType === 'INPATIENT' ? 'discharge' : 'submit');
  return {
    serviceType,
    needsPreauth: preauth.length > 0,
    manualApproval: preauth.some((i) => i.needsManualPreauthApproval === true),
    preauthInterventions: preauth.map((i) => i.code),
    specialPreauth: uniq(preauth.flatMap((i) => i.specialPreauth)),
    requiredDocuments: uniq(interventions.flatMap((i) => [...(i.needsPreauth ? i.requiredPreauthDocumentTypes : []), ...i.applicableDocumentTypes])),
    paymentMechanisms,
    accessPoints,
    funds: uniq(interventions.map((i) => i.fund)),
    steps,
    warnings,
  };
}

/** SHA transactions are blocked for beneficiaries reported deceased (eligibility isAlive=false). */
export function assertShaTransactable(patient: { sha?: { isAlive?: boolean | null } | null; deceasedAt?: Date | null } | null | undefined) {
  if (patient?.sha?.isAlive === false || patient?.deceasedAt) {
    throw new AppError(409, 'SHA_BENEFICIARY_DECEASED', 'SHA reports this beneficiary as deceased. SHA visits, authorizations, preauthorizations, billing and claims are blocked.');
  }
}
