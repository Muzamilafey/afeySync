# SHA workflow

```
Patient → DHA Client Registry (CR ID) → Eligibility → Benefits → Interventions → Utilization
        → Authorization / Visit consent → Preauth (if required) → Visit → Claim → Intervention
        → Resubmission → Approval → Payment / reconciliation
```

* **Eligibility** (`POST /api/v1/sha/eligibility`): send `{ patientId }` or an identification.
  For a patient, the ClientRegistry ID is used first and other identifiers are fallbacks, as the
  HIE docs recommend. Each check is stored in `ShaEligibilityCheck` and updates `patient.sha.status`.
* **Benefits / interventions / utilization** are queried by the patient's CR ID and use the
  `X-Facility-Id` / `X-Facility-Id-Type: fr-code` headers. The UI shows every boolean flag the HIE
  returns (preauth, doctor or member authorization required) and draws utilization bars when limit
  and used values are present.
* **Authorizations, preauthorizations and claims**: `ShaTransaction` records (reference
  `SHA-CLM-000001`, etc.) with a unique `idempotencyKey`. Drafts are created in AfeySync.
  Submission waits until the owner configures the matching HIE operation (see DHA.md).
* **Status callbacks** replace polling. To set them up, create an endpoint in Interoperability →
  Callbacks (the URL is shown once, with optional HMAC). Then register that URL with the HIE using
  the documented callback-registration operations. Each event goes through verify → identify tenant
  → dedupe → persist → match the record → update status and history → audit → notify the creator.
  Unmatched events are kept. Failed processing is queued (`SHA_CALLBACK`) and retried.
