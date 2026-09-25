# Private insurance (Slade360 / HealthCloud)

AfeySync handles private insurance through an `InsuranceIntegrationAdapter` abstraction
(`backend/src/modules/insurance/adapters`). The first adapter is **Slade360 / HealthCloud provider
EDI**. SHA is **not** a private insurer and keeps its own workflow (see [SHA.md](SHA.md)); the
registry only exposes a SHA eligibility shim so the dashboard can count SHA checks.

**Source of truth:** the HealthCloud API reference at https://web.healthcloud.sh/api-reference. The
default operation paths live in `backend/src/integrations/slade360/contract.ts` and can be
corrected in **Owner → API Config → Slade360 / HealthCloud** without a code change. Operations that
the reference does not define in a form we could confirm have **no path** and return
`501 INTEGRATION_OPERATION_NOT_CONFIGURED`:

| Operation | Default |
|---|---|
| `auth.token` | `POST /oauth2/token/` on the facility's token URL |
| `eligibility.member` | `GET /beneficiaries/member_eligibility/` |
| `contacts.sendOtp` | `POST /beneficiaries/beneficiary_contacts/{contact_id}/send_otp/` |
| `visit.start` | `POST /authorizations/start_visit/` |
| `authorization.validate` | `POST /authorizations/validate_authorization_token/` |
| `reservation.create` | `POST /balances/reservations/reserve_from_authorization/` |
| `claim.create` / `invoice.create` | `POST /claims/`, `POST /invoices/` |
| claim / invoice attachments | multipart upload |
| `remittances.list`, `remittance.claim` | `GET /remittances/`, `/remittances/claim_remittance/` |
| `claim.retrieve`, `creditNote.create` | **not configured** — enter the documented paths before use |

The documentation host could not be reached from the build environment. Treat every default as
needing confirmation against the reference in the Slade360 sandbox before go-live.

## Setup

1. **Owner → Facilities → Integrations:** enable *Slade360 private insurance* for the facility.
2. **Owner → Integrations → Slade360:** enable it globally. Slade360 is `facilityCredentialsOnly`:
   the platform never holds a shared Slade360 credential.
3. **Admin → Integrations → Slade360** (facility admin), with the values Slade360 issued to *this*
   facility:
   * Environment, `baseUrl` (sandbox default `https://provider-edi-api.multitenant.slade360.co.ke/v1`)
     and `authUrl` (sandbox default `https://accounts.multitenant.slade360.co.ke/oauth2/token/`).
     **Production URLs are never assumed** — enter the ones Slade360 gives you.
   * `grantType` exactly as Slade360 specifies for your account, plus `clientId`, `clientSecret`
     and, for password grants, `username` / `password`. Secrets are AES-256-GCM encrypted, masked
     in the UI and never sent to the browser.
   * `providerCode`, `locationCode`, `locationName`.
   * Authentication factor values `factorOtp`, `factorFingerprint`, `factorGuardian` — the factor
     identifiers from your Slade360 onboarding. A method whose factor is blank is refused with
     `SLADE_FACTOR_NOT_CONFIGURED`; AfeySync never fakes a fingerprint or guardian verification.
   * **Test connection** requests a token and reports `CONNECTED` or the mapped error.
4. **Insurance → Payers:** add the payers the facility contracts with (`payer_slade_code` from
   Slade360) and tick *Enabled* and *Supported*. *Add sandbox examples* inserts Slade360's sandbox
   example payers, disabled — they are **not** a production payer list.

## Workflow

```
Coverage → Eligibility → (OTP) → Start visit → Validate authorization → Reserve benefit
        → Claim (ICD-10) → Invoice (server totals) → Attachments → Status → Remittance → Reconcile
```

* **Coverages** (patient → Insurance tab): payer, member number, scheme, principal/dependant.
  Every change is kept in the coverage `history`. Eligibility stores the status, benefits and
  masked contacts only.
* **OTP** is sent by Slade360 to the beneficiary contact. AfeySync never logs or stores the OTP.
* **Start visit** sends the configured factor and returns the authorization and visit number.
  Tokens are stored as a reference only; raw responses are scrubbed of phone numbers and tokens.
* **Reserve** is protected by a unique `OperationLock`, so a double click cannot reserve twice.
* **Claims** use ICD-10 (`icd10_codes`). Diagnoses come from finalized consultations. A diagnosis
  coded in ICD-11 or a local code is **never converted silently**: the claim is refused with
  `DIAGNOSIS_NOT_MAPPED` until an ICD-10 code is recorded or a mapping is added under
  **Insurance → Payers → Code mappings** (with its reference).
* **Invoice:** lines and totals are computed on the server from the facility invoice. The browser
  only sends the copay, which is bounded by the gross amount. Corrections after submission are
  credit notes (reason required, audited).
* **Attachments:** PDF, PNG or JPEG patient documents, attached to the claim or invoice with a type
  (`CLAIM_FORM`, `PREAUTH_FORM`, `PRESCRIPTION`, `LAB_ORDER`, `IMAGING_ORDER`, `OTHER`).
* **Status refresh** maps the payer status to `PROCESSING` / `APPROVED` / `PARTIALLY_APPROVED` /
  `REJECTED` only on a clear match. **Approval never marks a claim as paid.**
* **Reconciliation:** remittances are synced from Slade360 (`Insurance → Remittances`) or fetched
  per claim. Reconciling one needs `amountPaid > 0`; it posts an idempotent `insurance` payment
  (`ins-rem:<remittanceId>`) capped at the invoice balance, records submitted / approved / paid /
  copay / variance, and sets `PAID` only when payment covers the approved amount.

## Screens and permissions

| Screen | Permission |
|---|---|
| Patient → Insurance tab (coverages, eligibility, authenticate & start visit) | `insurance.eligibility` (receptionist, cashier, insurance officer) |
| Insurance dashboard, claims, remittances, payers (view) | `insurance.view` |
| Reserve, claim, invoice, attachments, credit notes, reconcile, code mappings | `insurance.manage` |
| Payer directory edits | `insurance.manage` or `admin.integrations` |

The dashboard shows counts, amounts, receivables and monthly paid revenue. It does not rank
insurers.

## Errors

`SLADE_NOT_CONFIGURED` (503), `SLADE_AUTH_ERROR` (502), `SLADE_VALIDATION_ERROR` (422, with the
payer's field errors), `SLADE_NOT_FOUND`, `SLADE_DUPLICATE` (409), `SLADE_RATE_LIMITED` (429),
`SLADE_UNAVAILABLE` / `SLADE_UNREACHABLE` (503). A 401 refreshes the token and retries once;
idempotent reads retry once on 5xx. Every call is written to the integration log without secrets.
