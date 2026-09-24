import { AppError, badRequest } from '../../utils/errors';
import { hieRequest, type HieCallContext } from './hieClient';
import { normalizeEligibility, normalizeRegistryPatient, unwrapList } from './normalize';

/** Identification types supported by the Client Registry GET /patients (per current HIE docs). */
export const HIE_IDENTIFICATION_TYPES = [
  'National ID',
  'ClientRegistry ID',
  'Birth Notification',
  'Birth Certificate',
  'Alien ID',
  'Refugee ID',
  'Mandate Number',
] as const;
export type HieIdentificationType = (typeof HIE_IDENTIFICATION_TYPES)[number];

function assertIdentification(type: string, number: string) {
  if (!(HIE_IDENTIFICATION_TYPES as readonly string[]).includes(type)) throw badRequest('Unsupported identification type', { supported: HIE_IDENTIFICATION_TYPES });
  if (!/^[A-Za-z0-9\-/ ]{3,40}$/.test(number)) throw badRequest('Identification number is invalid', undefined, 'DHA_VALIDATION_ERROR');
}

export const DHAClientRegistryService = {
  async search(ctx: HieCallContext, identificationType: string, identificationNumber: string) {
    assertIdentification(identificationType, identificationNumber);
    try {
      const res = await hieRequest('dha', ctx, {
        operation: 'registry.client.search',
        query: { identification_number: identificationNumber.trim(), identification_type: identificationType },
      });
      return { found: true, results: unwrapList(res.data).map(normalizeRegistryPatient), latencyMs: res.latencyMs };
    } catch (err) {
      if (err instanceof AppError && err.code === 'DHA_NOT_FOUND') return { found: false, results: [], latencyMs: 0 };
      throw err;
    }
  },
};

export const DHAHealthWorkerRegistryService = {
  async search(ctx: HieCallContext, query: Record<string, string>) {
    const res = await hieRequest('dha', ctx, { operation: 'registry.practitioner.search', query });
    return unwrapList(res.data);
  },
};

export const DHAFacilityRegistryService = {
  async search(ctx: HieCallContext, query: Record<string, string>) {
    const res = await hieRequest('dha', ctx, { operation: 'registry.facility.search', query });
    return unwrapList(res.data);
  },
  async bedOccupancy(ctx: HieCallContext, facilityCode: string) {
    if (!/^[A-Za-z0-9\-_]{2,40}$/.test(facilityCode)) throw badRequest('Invalid facility code');
    const res = await hieRequest('sha', ctx, { operation: 'facility.beds.occupancy', pathParams: { facilityCode } });
    return res.data;
  },
};

export const SHAEligibilityService = {
  async check(ctx: HieCallContext, identificationType: string, identificationNumber: string) {
    assertIdentification(identificationType, identificationNumber);
    const res = await hieRequest('sha', ctx, {
      operation: 'sha.eligibility',
      query: { identification_number: identificationNumber.trim(), identification_type: identificationType },
    });
    return normalizeEligibility(res.data);
  },
};

const pageParams = (q: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
};

export const SHABenefitsService = {
  async benefits(ctx: HieCallContext, patientId: string, extra: Record<string, unknown> = {}) {
    if (!patientId) throw badRequest('patient_id is required');
    const res = await hieRequest('sha', ctx, { operation: 'sha.benefits', query: { patient_id: patientId, ...pageParams(extra) } });
    return res.data;
  },
  /** Supported filters per HIE catalog: sub_benefit_code, parent_intervention, page, page_size, sub_interventions, exclude_capitation, access_point, search, code */
  async interventions(ctx: HieCallContext, patientId: string, filters: Record<string, unknown>) {
    if (!patientId) throw badRequest('patient_id is required');
    const allowed = ['sub_benefit_code', 'parent_intervention', 'page', 'page_size', 'sub_interventions', 'exclude_capitation', 'access_point', 'search', 'code'];
    const query: Record<string, string> = { patient_id: patientId };
    for (const k of allowed) if (filters[k] !== undefined && filters[k] !== '') query[k] = String(filters[k]);
    const res = await hieRequest('sha', ctx, { operation: 'sha.interventions', query });
    return res.data;
  },
  async utilization(ctx: HieCallContext, patientId: string, interventionCode: string) {
    if (!patientId || !interventionCode) throw badRequest('patient_id and intervention_code are required');
    const res = await hieRequest('sha', ctx, { operation: 'sha.utilization', query: { patient_id: patientId, intervention_code: interventionCode } });
    return res.data;
  },
};

/** Thin, contract-driven wrappers. They execute only once the owner configures the operation path. */
export const DHATerminologyService = {
  lookup: (ctx: HieCallContext, query: Record<string, string>) => hieRequest('dha', ctx, { operation: 'terminology.lookup', query }).then((r) => r.data),
  search: (ctx: HieCallContext, query: Record<string, string>) => hieRequest('dha', ctx, { operation: 'terminology.search', query }).then((r) => r.data),
  validate: (ctx: HieCallContext, query: Record<string, string>) => hieRequest('dha', ctx, { operation: 'terminology.validate', query }).then((r) => r.data),
  translate: (ctx: HieCallContext, query: Record<string, string>) => hieRequest('dha', ctx, { operation: 'terminology.translate', query }).then((r) => r.data),
};

export const DHASharedHealthRecordService = {
  openVisit: (ctx: HieCallContext, body: unknown, idempotencyKey: string) => hieRequest('dha', ctx, { operation: 'shr.visit.open', body, idempotencyKey }).then((r) => r.data),
  write: (ctx: HieCallContext, bundle: unknown, idempotencyKey: string) => hieRequest('dha', ctx, { operation: 'shr.records.write', body: bundle, idempotencyKey }).then((r) => r.data),
  read: (ctx: HieCallContext, query: Record<string, string>) => hieRequest('dha', ctx, { operation: 'shr.records.read', query }).then((r) => r.data),
};
