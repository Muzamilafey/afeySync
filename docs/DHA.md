# DHA HIE integration

Source of truth: **https://hie-docs.dha.go.ke/**. Its sections are Authentication, Integration
Scenarios, Claims & Preauths, Consent Services, Registries, Terminology Service, Shared Health
Record, API Catalog and Go-Live Process. The documentation changes over time, so re-verify the
contract before each release.

## Authentication

`POST {baseUrl}/tenants/token` with `application/x-www-form-urlencoded` fields `client_id` and
`client_secret` returns `access_token`, `expires_in` and `token_type`. The UAT base URL is
`https://ilm-dev.dha.go.ke/uat-middleware/api/v1`.

AfeySync caches tokens per configuration and renews them 60 s before expiry. Concurrent renewals
share one request (single-flight). A `401` triggers one forced renewal. The client secret never
leaves the server.

## Configured operations (default contract)

| Key | Method / path | Used for |
|---|---|---|
| `registry.client.search` | `GET /patients?identification_number&identification_type` | Register/Find Patient |
| `sha.eligibility` | `GET /patients/eligibility` | SHA eligibility |
| `sha.benefits` | `GET /patients/benefits?patient_id` | Benefits |
| `sha.interventions` | `GET /patients/benefits/interventions` | Interventions (preauth, doctor and member flags) |
| `sha.utilization` | `GET /patients/benefits/utilization?patient_id&intervention_code` | Utilization |
| `facility.beds.occupancy` | `GET /facilities/{facilityCode}/beds/occupancy` | Occupancy |

Supported identification types: National ID, ClientRegistry ID, Birth Notification, Birth
Certificate, Alien ID, Refugee ID and Mandate Number.

## Declared, not yet configured

Health Worker and Facility Registry search, authorization (OTP/biometric), visit consent, virtual
claims, preauthorization, billing lines, claim attachments/diagnoses/lines/preview/dispatch,
interventions (add/restore/retire/switch/respond), emergency claims (the current workflow; the old
EMT endpoint was withdrawn), ePrescription, status-callback registration, consent, SHR and
terminology.

The owner enters each path in **Owner → API Config** from the official catalog. Until a path is
entered, calls fail with `501 INTEGRATION_OPERATION_NOT_CONFIGURED`.

## Response handling

`integrations/hie/normalize.ts` picks common fields for display and **always** keeps the raw
payload. The UI shows the raw response as well. Review the field aliases whenever the contract
version changes.

## Services

`DHAClientRegistryService`, `DHAHealthWorkerRegistryService`, `DHAFacilityRegistryService`,
`DHATerminologyService`, `DHASharedHealthRecordService` and the SHA services live in
`backend/src/integrations/hie/services.ts`.

## Error codes

`DHA_VALIDATION_ERROR`, `DHA_AUTH_ERROR`, `DHA_NOT_FOUND`, `DHA_DUPLICATE`, `DHA_RATE_LIMITED`,
`DHA_UNAVAILABLE`, `DHA_UPSTREAM_ERROR`, `DHA_UNREACHABLE`, `INTEGRATION_DISABLED` and
`INTEGRATION_NOT_ENABLED_FOR_FACILITY`. The same codes exist with the `SHA_` prefix.

## Retries

Only idempotent operations are retried: up to 3 attempts on network errors, 429 and 502/503/504,
with exponential backoff that respects `Retry-After`. Validation errors, authentication errors and
business rejections are never retried.

## ePrescription

* Prescriptions map to a FHIR transaction Bundle: the Patient plus one `MedicationRequest` per
  item, carrying the dosage text, quantity and supply duration. Dispensing maps to
  `MedicationDispense` resources that reference their MedicationRequest.
* Endpoints (`/api/v1/pharmacy/prescriptions/:id/eprescription`):
  * `GET …/bundle`: local preview and validation
  * `POST …/preview`: HIE preview
  * `POST …` (send): needs `prescription.create` and the patient's CR ID
  * `POST …/dispense`: report the dispense; needs `pharmacy.dispense`
* The contract operations are `eprescription.preview`, `eprescription.create` and
  `eprescription.dispense`. Until they are configured, calls return 501 and nothing is recorded as
  sent. Failures are recorded on the prescription (`ePrescription.status/lastError`).

## Terminology

Interoperability → Terminology calls `terminology.search|lookup|validate|translate` with
key/value parameters. The parameter names come from the HIE terminology contract, so AfeySync does
not hard-code them.
