# API

* Base path: `/api/v1`. The OpenAPI document is served at `/api/docs` (Swagger UI) and
  `/api/docs/openapi.json`. It lists every mounted route: `npm run openapi:routes` regenerates
  `src/openapi.routes.generated.ts` from the route files, and the curated entries in
  `src/openapi.ts` take precedence.
* Authentication: `Authorization: Bearer <access token>`. The refresh token is a cookie.
  Branch selection uses `X-Branch-Id`.
* Success responses: `{ "success": true, "data": …, "meta": { page, limit, total } }`.
* Error responses: `{ "success": false, "error": { "code": "DHA_VALIDATION_ERROR", "message": "…", "requestId": "…" } }`.
* Idempotency: SHA transactions accept `idempotencyKey`. Jobs and callback events are deduplicated
  by unique keys.
* Main groups:
  * Public onboarding: `/onboarding/*` (see ONBOARDING.md); owner review at `/owner/onboarding/*`
  * Platform & admin: `/auth`, `/owner/*` (incl. `/owner/backups`), `/branches`, `/users`, `/roles`, `/permissions`, `/admin/*`, `/dashboard`, `/notifications`
  * Registration & front desk: `/patients`, `/visits`, `/queues`, `/referrals`, `/appointments`
  * Clinical: `/opd/*`, `/consultations`, `/laboratory/*`, `/radiology/*`, `/pharmacy/*`, `/inpatient/*`, `/maternity/*`, `/mch/*`, `/family-planning/*`, `/dental/*`, `/mortuary/*`, `/documents`
  * Finance & supply: `/billing/*`, `/payments/mpesa/*`, `/inventory/*`, `/procurement/*`, `/finance/*`, `/hr/*`, `/reports`
  * Interoperability: `/dha/*`, `/sha/*` (incl. `/sha/visits/*`, `/sha/transactions/*`), `/fhir/*`
  * Private insurance: `/insurance/*` (payers, coverages, visits, claims, remittances, dashboard) and `/integrations/slade360/*` aliases
  * Public (secret-token URLs): `/sha|dha/callbacks/:token`, `/payments/mpesa/callback/:token`, `/payments/mpesa/c2b/:token/*`
* Reports: `GET /reports` lists the reports available to the caller. `GET /reports/:key?from&to`
  returns `{ columns, rows, summary }`. Add `&format=csv` for CSV, which needs `reports.export`, is
  audited and neutralises formula injection.
* Documents: multipart `POST /documents` (field `file`) accepts PDF, PNG, JPEG or DICOM up to
  15 MB. The type is detected from the file's content. Downloads are audited and sent with
  `Cache-Control: no-store`.
* The schemas for external SHA/DHA calls are defined by the official DHA HIE documentation, and those
  for Slade360 by the HealthCloud API reference. Neither is redefined here.
