import { Router } from 'express';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse } from '../../utils/validate';
import { authenticateTenant, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/auditService';
import { DHAClientRegistryService, DHAFacilityRegistryService, DHAHealthWorkerRegistryService, DHATerminologyService, HIE_IDENTIFICATION_TYPES } from '../../integrations/hie/services';
import { findDuplicates } from '../patients/patientService';
import { integrationStatusForTenant, resolveIntegration } from '../integrations/integrationConfigService';
import { tokenStatus } from '../../integrations/hie/hieClient';
import { meta } from '../../models/meta';
import type { Request } from 'express';

const router = Router();
router.use(authenticateTenant);

const ctx = (req: Request) => ({ tenantId: req.tenant!.id, userId: req.user!.id, branchId: req.branch?.id, requestId: req.requestId });
const mask = (v: string) => (v.length > 4 ? `${'*'.repeat(v.length - 4)}${v.slice(-4)}` : '****');

router.get('/identification-types', (_req, res) => {
  res.json({ success: true, data: HIE_IDENTIFICATION_TYPES });
});

/** Client Registry: GET /patients?identification_number&identification_type (proxied, never from the browser). */
router.get(
  '/registries/patients',
  requirePermission('dha.registry'),
  h(async (req, res) => {
    const q = parse(z.object({ identification_type: z.enum(HIE_IDENTIFICATION_TYPES), identification_number: z.string().trim().min(3).max(40) }), req.query);
    const result = await DHAClientRegistryService.search(ctx(req), q.identification_type, q.identification_number);
    const annotated = await Promise.all(
      result.results.map(async (r) => ({
        ...r,
        existingPatient: (await findDuplicates(req, { clientRegistryId: r.clientRegistryId, nationalId: r.nationalId, identifiers: [{ type: q.identification_type, value: q.identification_number }] }))[0] ?? null,
      })),
    );
    await audit(req, { action: 'dha.client_registry.search', resource: 'dha_registry', newValue: { identificationType: q.identification_type, identificationNumber: mask(q.identification_number), found: result.found, count: result.results.length } });
    res.json({ success: true, data: { found: result.found && annotated.length > 0, results: annotated } });
  }),
);

router.get(
  '/registries/practitioners',
  requirePermission('dha.registry'),
  h(async (req, res) => {
    const q = parse(z.record(z.string(), z.string().max(60)), req.query);
    const data = await DHAHealthWorkerRegistryService.search(ctx(req), q);
    await audit(req, { action: 'dha.health_worker_registry.search', resource: 'dha_registry', newValue: Object.keys(q) });
    res.json({ success: true, data });
  }),
);

router.get(
  '/registries/facilities',
  requirePermission('dha.registry'),
  h(async (req, res) => {
    const q = parse(z.record(z.string(), z.string().max(60)), req.query);
    const data = await DHAFacilityRegistryService.search(ctx(req), q);
    res.json({ success: true, data });
  }),
);

for (const fn of ['lookup', 'search', 'validate', 'translate'] as const) {
  router.get(
    `/terminology/${fn}`,
    requirePermission('dha.terminology'),
    h(async (req, res) => {
      const q = parse(z.record(z.string(), z.string().max(200)), req.query);
      res.json({ success: true, data: await DHATerminologyService[fn](ctx(req), q) });
    }),
  );
}

router.get(
  '/status',
  requirePermission('dha.view'),
  h(async (req, res) => {
    const status = (await integrationStatusForTenant(req.tenant!.id)).dha;
    let token: { valid: boolean; expiresAt?: Date } = { valid: false };
    if (status.enabled) {
      const cfg = await resolveIntegration('dha', req.tenant!.id).catch(() => null);
      if (cfg) token = tokenStatus(cfg);
    }
    const last = await meta().IntegrationLog.findOne({ tenantId: req.tenant!.id, provider: 'dha' }).sort({ createdAt: -1 }).select('createdAt status operation').lean();
    const contract = await meta().IntegrationContract.findOne({ provider: 'dha', active: true }).select('contractVersion lastVerified documentationURL supportedOperations.key supportedOperations.path supportedOperations.group').lean();
    res.json({
      success: true,
      data: {
        ...status,
        token: token.valid ? 'VALID' : 'NOT CACHED',
        lastApiCall: last,
        contract: contract && {
          version: contract.contractVersion,
          lastVerified: contract.lastVerified,
          documentationURL: contract.documentationURL,
          configuredOperations: contract.supportedOperations.filter((o) => o.path).length,
          totalOperations: contract.supportedOperations.length,
        },
      },
    });
  }),
);

export default router;
