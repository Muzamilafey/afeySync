/**
 * OpenAPI description of AfeySync's own API. External SHA/DHA contracts are NOT redefined here —
 * they are referenced to the official DHA HIE documentation (https://hie-docs.dha.go.ke/).
 */
import { generatedRoutes } from './openapi.routes.generated';

export type RouteDoc = { summary: string; permission?: string; public?: boolean; tag: string };
type Op = RouteDoc;

const routes: Record<string, Record<string, Op>> = {
  '/health': { get: { summary: 'Liveness', public: true, tag: 'Health' } },
  '/health/database': { get: { summary: 'Database health', public: true, tag: 'Health' } },
  '/health/integrations': { get: { summary: 'Integration status (no secrets)', public: true, tag: 'Health' } },
  '/api/v1/auth/login': { post: { summary: 'Facility login (tenant resolved from hostname)', public: true, tag: 'Auth' } },
  '/api/v1/auth/refresh': { post: { summary: 'Rotate refresh token (cookie + X-Requested-With: AfeySync)', public: true, tag: 'Auth' } },
  '/api/v1/auth/logout': { post: { summary: 'Logout / revoke session family', tag: 'Auth' } },
  '/api/v1/auth/me': { get: { summary: 'Current user, permissions, branches, integration status', tag: 'Auth' } },
  '/api/v1/auth/change-password': { post: { summary: 'Change password', tag: 'Auth' } },
  '/api/v1/owner/auth/login': { post: { summary: 'Platform owner login', public: true, tag: 'Owner' } },
  '/api/v1/owner/dashboard': { get: { summary: 'Platform overview (no clinical data)', tag: 'Owner' } },
  '/api/v1/owner/tenants': { get: { summary: 'List facilities', permission: 'owner.tenants', tag: 'Owner' }, post: { summary: 'Create facility (wizard: provisions DB, roles, admin, domains)', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}': { get: { summary: 'Facility details', permission: 'owner.tenants', tag: 'Owner' }, patch: { summary: 'Update facility', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/suspend': { post: { summary: 'Suspend facility', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/activate': { post: { summary: 'Activate facility', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/reset-admin': { post: { summary: 'Reset facility administrator password', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/branches': { post: { summary: 'Create branch', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/domains': { post: { summary: 'Add custom/branch domain', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/subscription': { put: { summary: 'Manage subscription', permission: 'owner.subscriptions', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/integrations': { put: { summary: 'Enable providers for facility', permission: 'owner.integrations', tag: 'Owner' } },
  '/api/v1/owner/tenants/{id}/health': { get: { summary: 'Facility database health', permission: 'owner.tenants', tag: 'Owner' } },
  '/api/v1/owner/integrations': { get: { summary: 'Platform integrations (masked)', permission: 'owner.integrations', tag: 'Owner' } },
  '/api/v1/owner/integrations/{provider}': { put: { summary: 'Configure / rotate / enable provider', permission: 'owner.integrations', tag: 'Owner' } },
  '/api/v1/owner/integrations/{provider}/test': { post: { summary: 'Test connection', permission: 'owner.integrations', tag: 'Owner' } },
  '/api/v1/owner/integration-logs': { get: { summary: 'Integration logs', permission: 'owner.logs', tag: 'Owner' } },
  '/api/v1/owner/contracts/{provider}': { get: { summary: 'Integration contract', permission: 'owner.integrations', tag: 'Owner' }, patch: { summary: 'Update operation paths from official docs', permission: 'owner.integrations', tag: 'Owner' } },
  '/api/v1/owner/system/health': { get: { summary: 'Platform health', tag: 'Owner' } },
  '/api/v1/owner/support-access': { get: { summary: 'Support access requests', permission: 'owner.support', tag: 'Owner' }, post: { summary: 'Request support access (reason, duration)', permission: 'owner.support', tag: 'Owner' } },
  '/api/v1/owner/support-access/{id}/session': { post: { summary: 'Start approved, time-limited support session', permission: 'owner.support', tag: 'Owner' } },
  '/api/v1/branches': { get: { summary: 'Branches in scope', tag: 'Organization' }, post: { summary: 'Create branch', permission: 'admin.branches', tag: 'Organization' } },
  '/api/v1/branches/{id}': { get: { summary: 'Branch', tag: 'Organization' }, patch: { summary: 'Update / configure branch', permission: 'admin.branches', tag: 'Organization' } },
  '/api/v1/users': { get: { summary: 'Users', permission: 'admin.users', tag: 'Organization' }, post: { summary: 'Create user', permission: 'admin.users', tag: 'Organization' } },
  '/api/v1/roles': { get: { summary: 'Roles', tag: 'Organization' }, post: { summary: 'Create custom role', permission: 'admin.roles', tag: 'Organization' } },
  '/api/v1/permissions': { get: { summary: 'Permission catalog', tag: 'Organization' } },
  '/api/v1/admin/integrations': { get: { summary: 'Facility integration status', permission: 'admin.integrations', tag: 'Admin' } },
  '/api/v1/admin/system-health/integrations': { get: { summary: 'Integration health cards', permission: 'admin.integrations', tag: 'Admin' } },
  '/api/v1/admin/support-access/{id}/{decision}': { post: { summary: 'Approve / reject / revoke support access', permission: 'admin.support_access', tag: 'Admin' } },
  '/api/v1/admin/audit': { get: { summary: 'Audit trail', permission: 'admin.audit', tag: 'Admin' } },
  '/api/v1/patients/search': { get: { summary: 'Fast patient search (name, phone, ID, CR ID, AFS no, SHA, insurance)', permission: 'patients.search', tag: 'Patients' } },
  '/api/v1/patients': { get: { summary: 'List patients', permission: 'patients.view', tag: 'Patients' }, post: { summary: 'Register new patient (duplicate-safe)', permission: 'patients.create', tag: 'Patients' } },
  '/api/v1/patients/import-dha': { post: { summary: 'Import patient from DHA Client Registry', permission: 'patients.create + dha.registry', tag: 'Patients' } },
  '/api/v1/patients/duplicate-check': { post: { summary: 'Tenant-wide duplicate check', permission: 'patients.create', tag: 'Patients' } },
  '/api/v1/patients/{id}': { get: { summary: 'Patient profile', permission: 'patients.view', tag: 'Patients' }, patch: { summary: 'Update patient', permission: 'patients.edit', tag: 'Patients' } },
  '/api/v1/patients/{id}/timeline': { get: { summary: 'Patient timeline', permission: 'patients.view', tag: 'Patients' } },
  '/api/v1/dha/registries/patients': { get: { summary: 'DHA Client Registry search (GET /patients upstream)', permission: 'dha.registry', tag: 'DHA' } },
  '/api/v1/dha/registries/practitioners': { get: { summary: 'Health Worker Registry', permission: 'dha.registry', tag: 'DHA' } },
  '/api/v1/dha/registries/facilities': { get: { summary: 'Facility Registry', permission: 'dha.registry', tag: 'DHA' } },
  '/api/v1/dha/terminology/{fn}': { get: { summary: 'Terminology lookup/search/validate/translate', permission: 'dha.terminology', tag: 'DHA' } },
  '/api/v1/dha/status': { get: { summary: 'DHA integration status', permission: 'dha.view', tag: 'DHA' } },
  '/api/v1/sha/eligibility': { post: { summary: 'SHA eligibility (GET /patients/eligibility upstream)', permission: 'sha.eligibility', tag: 'SHA' } },
  '/api/v1/sha/benefits': { get: { summary: 'SHA benefits (GET /patients/benefits upstream)', permission: 'sha.eligibility', tag: 'SHA' } },
  '/api/v1/sha/interventions': { get: { summary: 'Benefit interventions', permission: 'sha.eligibility', tag: 'SHA' } },
  '/api/v1/sha/utilization': { get: { summary: 'Utilization balances', permission: 'sha.eligibility', tag: 'SHA' } },
  '/api/v1/sha/facility/beds-occupancy': { get: { summary: 'Facility bed occupancy', permission: 'sha.view', tag: 'SHA' } },
  '/api/v1/sha/transactions': { get: { summary: 'Authorizations/preauths/claims', permission: 'sha.view', tag: 'SHA' }, post: { summary: 'Create draft (idempotent)', permission: 'sha.authorization|sha.preauthorization|sha.claim', tag: 'SHA' } },
  '/api/v1/sha/callback-endpoints': { get: { summary: 'Callback endpoints', permission: 'admin.integrations', tag: 'SHA' }, post: { summary: 'Create callback endpoint (URL shown once)', permission: 'admin.integrations', tag: 'SHA' } },
  '/api/v1/sha/callbacks/{token}': { post: { summary: 'HIE status callback receiver (verified)', public: true, tag: 'Callbacks' } },
  '/api/v1/dha/callbacks/{token}': { post: { summary: 'HIE (DHA) status callback receiver (verified)', public: true, tag: 'Callbacks' } },
  '/api/v1/auth/forgot-password': { post: { summary: 'Request password reset email (response never reveals whether the account exists)', public: true, tag: 'Auth' } },
  '/api/v1/auth/reset-password': { post: { summary: 'Reset password with single-use emailed token (revokes all sessions)', public: true, tag: 'Auth' } },
  '/api/v1/owner/backups': { get: { summary: 'Backup freshness per facility and recent backup runs', permission: 'owner.platform', tag: 'Owner' } },
  '/api/v1/sha/transactions/from-invoice': { post: { summary: 'Build an SHA claim draft from an SHA-payer invoice (lines + finalized diagnoses)', permission: 'sha.claim', tag: 'SHA' } },
  '/api/v1/sha/transactions/{id}/submit': { post: { summary: 'Submit via the configured HIE contract operation (501 until configured; never faked)', permission: 'per transaction kind', tag: 'SHA' } },
  '/api/v1/sha/transactions/{id}/decision': { post: { summary: 'Record an SHA decision received outside callbacks (note required, audited)', permission: 'per transaction kind', tag: 'SHA' } },
  '/api/v1/sha/transactions/{id}/reconcile': { post: { summary: 'Record SHA remittance: posts idempotent sha payment to the claim invoice', permission: 'sha.reconciliation', tag: 'SHA' } },
  '/api/v1/sha/transactions/{id}/fhir': { get: { summary: 'FHIR R4 Claim preview with structural validation', permission: 'sha.view', tag: 'SHA' } },
  '/api/v1/documents': { get: { summary: 'List documents (by patient / related record, branch-scoped)', permission: 'documents.view', tag: 'Documents' }, post: { summary: 'Upload (multipart field file; PDF/PNG/JPEG/DICOM ≤ 15 MB, sniffed)', permission: 'documents.upload', tag: 'Documents' } },
  '/api/v1/documents/{id}/download': { get: { summary: 'Download (audited, no-store)', permission: 'documents.view', tag: 'Documents' } },
  '/api/v1/reports/{key}': { get: { summary: 'Run report for from/to; format=csv requires reports.export (audited)', permission: 'reports.view', tag: 'Reports' } },
  '/api/v1/fhir/outbox': { get: { summary: 'FHIR outbox entries and status counts', permission: 'dha.fhir', tag: 'FHIR' } },
  '/api/v1/fhir/outbox/{id}/retry': { post: { summary: 'Revalidate and requeue a failed/blocked entry', permission: 'dha.fhir', tag: 'FHIR' } },
  '/api/v1/dashboard': { get: { summary: 'Facility dashboard (sections by permission)', tag: 'Dashboard' } },
  '/api/v1/notifications': { get: { summary: 'My notifications', tag: 'Notifications' } },
};

// Every mounted route is listed (generated from the route files); curated entries above win.
const merged: Record<string, Record<string, Op>> = { ...generatedRoutes };
for (const [path, ops] of Object.entries(routes)) merged[path] = { ...(merged[path] ?? {}), ...ops };

const paths: Record<string, unknown> = {};
for (const [path, ops] of Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))) {
  paths[path] = Object.fromEntries(
    Object.entries(ops).map(([method, op]) => [
      method,
      {
        tags: [op.tag],
        summary: op.summary,
        description: op.permission ? `Requires permission: \`${op.permission}\`` : undefined,
        security: op.public ? [] : [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
          '4XX': { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    ]),
  );
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AfeySync API',
    version: '1.0.0',
    description:
      'AfeySync multi-tenant HMIS API. The tenant is always resolved server-side from the hostname / session. ' +
      'External SHA/DHA HIE request/response schemas are defined by the official DHA HIE documentation (https://hie-docs.dha.go.ke/) and are not redefined here.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Success: { type: 'object', properties: { success: { type: 'boolean', example: true }, data: {}, meta: { type: 'object' } } },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'object', properties: { code: { type: 'string', example: 'DHA_VALIDATION_ERROR' }, message: { type: 'string', example: 'Patient identifier is invalid' }, requestId: { type: 'string' } } },
        },
      },
    },
  },
  paths,
};
