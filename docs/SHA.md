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
