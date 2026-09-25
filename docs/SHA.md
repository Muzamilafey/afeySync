# SHA workflow

```
Patient → DHA Client Registry (CR ID) → Eligibility → Benefits → Interventions → Utilization
        → Authorization / Visit consent → Preauth (if required) → Visit → Claim → Intervention
        → Resubmission → Approval → Payment / reconciliation
```

* **Eligibility** (`POST /api/v1/sha/eligibility`): send `{ patientId }` or an identification.
  For a patient, the ClientRegistry ID is used first and other identifiers are fallbacks, as the
  HIE docs recommend. Each check is stored in `ShaEligibilityCheck` and updates
  `patient.sha.status`. SHA-payer visits require an eligible check from the last 24 hours.
* **Benefits / interventions / utilization** are queried by the patient's CR ID and use the
  `X-Facility-Id` / `X-Facility-Id-Type: fr-code` headers. The UI shows every boolean flag the HIE
  returns (preauth, doctor or member authorization required) and draws utilization bars when limit
  and used values are present.

## eClaims visit workflow (SHA Visits)

The primary SHA path is the **SHA visit** (`ShaVisit`, `/api/v1/sha/visits`, UI: SHA → SHA Visits
→ New, or *Start SHA visit* on the patient record). It follows the DHA HIE eClaims guide:

| # | Step | AfeySync | HIE operation |
|---|---|---|---|
| 1 | Facility connection | `GET /sha/connection`, `POST /sha/connection/test` (NOT_CONFIGURED / PENDING / CONNECTED / ERROR, no secrets) | `auth.token` |
| 2 | Find patient / CR ID | Client Registry search and import | `registry.client.search` |
| 3 | Eligibility | stores `isAlive`, `whitelistedForOTP`, `facilityBiometricsEnforced`, schemes, POMSF | `sha.eligibility` |
| 4 | Deceased block | `isAlive=false` blocks every SHA transaction (`409 SHA_BENEFICIARY_DECEASED`) | — |
| 5–6 | Benefits, sub-benefits | benefits panel | `sha.benefits`, `sha.subBenefits` |
| 7 | Interventions | flags drive the workflow — never hard-coded rules | `sha.interventions` |
| 8 | Utilization, POMSF balances | utilization bars, `GET /sha/pomsf-balances` | `sha.utilization`, `sha.pomsf.balances` |
| 9 | Workflow decision | `POST /sha/workflow` re-reads the flags from DHA per code (preauth, doctor or member authorization, emergency) | `sha.interventions` |
| 10 | Contacts | masked contacts | `sha.contacts` |
| 11 | OTP | refused (`SHA_BIOMETRICS_REQUIRED`) when biometrics are enforced and the member is not whitelisted. The OTP is never logged or stored. | `sha.otp.send` |
| 12 | Authorize | OTP, biometric (`factors: ['SHA']`, `is_integration: true`, provider = facility FR code) or minor biometric (facility setting `sha.minorBiometrics`) | `sha.authorization.create`, `sha.biometrics.match.*` |
| 13 | Start visit | OTP or `auth_guid` plus practitioner; all returned DHA identifiers are stored | `sha.visit.consent.start` |
| 14 | Interventions on the claim | add / restore / retire / switch | `sha.intervention.*` |
| 15 | Preauthorization | multipart with documents; get, cancel (reason), remove diagnoses/doctors. Claim submission is blocked while a preauth is pending. | `sha.preauth.*` |
| 16 | Effective coverage (POMSF) | `POST /sha/visits/:id/effective-coverage` | `sha.coverage.effective` |
| 17 | Diagnoses, billable items, attachments | claim steps | `sha.claim.diagnoses.add`, `sha.billing.lineItems`, `sha.claim.attachments.add` |
| 18 | Preview | provider / payer preview | `sha.claim.preview.*` |
| 19 | Submit (OP) / discharge (IP) | OP submits the virtual claim; IP discharges | `sha.virtualClaim.submit`, `sha.claim.discharge` |
| 20 | Close, edit/resubmit lines, decisions, remittance | claim steps, callbacks, reconciliation | `sha.virtualClaim.close`, `sha.claim.lines.*` |

**Operation status.** Operations marked `spec_unverified` (steps 5–16) carry the paths given in the
integration specification; the HIE documentation host was not reachable from the build
environment, so the platform owner must confirm each one against https://hie-docs.dha.go.ke/ in
**Owner → API Config**. Saving a path there marks it `owner_verified`. Steps 17–20 have **no path**
until the owner enters them and return `501 INTEGRATION_OPERATION_NOT_CONFIGURED`; the visit keeps
its state and the step can be retried later.

**Facility identity.** The `X-Facility-Id` header uses each facility's own DHA Facility Registry
code (Owner → Facility → DHA registry), never a shared platform code.

**Consent tokens** are AES-256-GCM encrypted, excluded from queries by default, and redacted from
the stored response trail. Biometric verification and eKYC are never simulated.

**Environment.** `DHA_ENV` (`uat` | `production`), `DHA_TIMEOUT_MS`, and `DHA_ENABLE_CALLBACKS`
(callbacks return 503 unless it is `true`). Production URLs are configured, never assumed.

Claims attached to a SHA visit must go through the visit workflow; the older transaction submit
refuses them with `SHA_USE_VISIT_WORKFLOW`.

## Transactions and claims

Authorizations, visit consents, preauthorizations, claims and emergency claims are
`ShaTransaction` records (reference `SHA-CLM-000001`, etc.) with a unique `idempotencyKey` and a
full `statusHistory`.

| Step | Endpoint | Permission |
|---|---|---|
| Draft (manual) | `POST /sha/transactions` | per kind |
| Claim from invoice | `POST /sha/transactions/from-invoice` | `sha.claim` |
| Edit draft | `PATCH /sha/transactions/:id` (draft/failed only) | per kind |
| FHIR preview | `GET /sha/transactions/:id/fhir` | `sha.view` |
| Submit | `POST /sha/transactions/:id/submit` | per kind |
| Record decision | `POST /sha/transactions/:id/decision` (note required, audited) | per kind |
| Intervention response | `POST /sha/transactions/:id/intervention-response` | `sha.intervention` |
| Reopen / resubmit | `POST /sha/transactions/:id/resubmit` | per kind |
| Cancel (unsent only) | `POST /sha/transactions/:id/cancel` | per kind |
| Remittance | `POST /sha/transactions/:id/reconcile` | `sha.reconciliation` |

* **From invoice:** only SHA-payer invoices qualify, with one active claim per invoice. Lines come
  from the non-voided invoice lines at the SHA price list. Diagnoses come from the visit's
  finalized consultations. The access point is IP when the visit has an admission.
* **Submission** builds a FHIR `Claim` (see FHIR.md) with the patient's CR ID and checks that it is
  complete (lines, diagnoses, intervention code, CR ID). It then calls the contract operation for
  the kind:
  `sha.claim.discharge`, `sha.emergency.claim.create`, `sha.preauth.create`,
  `sha.authorization.create`, `sha.visit.consent.start`. These operations have **no path** until
  the platform owner enters one from the official catalog. Until then, submit returns
  `501 INTEGRATION_OPERATION_NOT_CONFIGURED` and the record stays in `draft`. An exchange error
  marks it `failed`, and it can be corrected and resubmitted. Each attempt sends a distinct
  idempotency key. The eClaims IG defines the exact payload. Verify it in UAT before go-live.
* **Decisions** come from verified callbacks or, when read on the SHA portal, are recorded
  manually with a note. The approved amount may not exceed the claimed amount.
* **Reconciliation** posts a `Payment` with method `sha` to the claim's invoice. It is idempotent
  per remittance reference and cannot exceed the approved amount or the invoice balance. The claim
  becomes `paid` once the approved amount is received.
* **Emergency claims:**
  * Once submitted, SHA's emergency protocols can be listed and added
    (`sha.emergency.protocols.list` / `sha.emergency.protocol.add`).
  * Attending doctors can be added or removed (`sha.emergency.doctor.add` / `.remove`). Each is
    identified by the licence or registry number on their user profile.
  * Endpoints: `GET /sha/emergency/protocols`, `GET /sha/emergency/doctors`, and
    `POST|DELETE /sha/transactions/:id/emergency/...`.
  * The payload field names (`claim_reference`, `protocol_code`, `registration_number`) must be
    checked against the HIE catalog when the owner configures these operations.
* **Attachments:** documents uploaded against the transaction (`relatedResource: sha_transaction`)
  are linked to it.

## Status callbacks

Status callbacks replace polling. To set them up, create an endpoint in Interoperability →
Callbacks (the URL is shown once, with optional HMAC). Then register that URL with the HIE using
the documented callback-registration operations. Each event goes through verify → identify tenant
→ dedupe → persist → match the record → update status and history → audit → notify the creator.
Unmatched events are kept. Failed processing is queued (`SHA_CALLBACK`) and retried.

Technical submission, SHA UAT and certification are separate milestones. AfeySync never reports a
facility as "SHA integrated" or "certified".
