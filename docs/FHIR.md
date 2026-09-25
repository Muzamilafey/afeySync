# FHIR R4

Code: `backend/src/modules/fhir/` (`mappers.ts`, `validator.ts`, `outbox.ts`, `fhir.routes.ts`).

## Profiles and identifiers

The Kenya Core FHIR IG (v1.0.0, FHIR 4.0.1) is the foundation for the domain IGs (eClaims,
ePrescription, Patient Summary, Emergency, NCCP). AfeySync does **not** hard-code its canonical
profile URLs or national identifier systems. Each facility configures them from the published IG
in two facility settings:

* `fhir.profiles`: resource type → profile URL, emitted as `meta.profile`.
* `fhir.identifierSystems`: for example `National ID`, `ClientRegistry ID`, `SHA Number`,
  `practitionerLicense`, `facilityCode`.

Until these are configured, resources carry no `meta.profile`, and identifiers use AfeySync's own
namespace (`https://fhir.afeysync.com/sid/...`).

## Mappings

| AfeySync | FHIR |
|---|---|
| Patient (identifiers, contacts, address, next of kin) | Patient, RelatedPerson |
| Facility / branch | Organization / Location |
| User / staff | Practitioner, PractitionerRole |
| Visit | Encounter (with ranked diagnoses) |
| Consultation diagnoses | Condition (ICD-11 codes when given) |
| Vitals | Observation (LOINC-coded vital signs, UCUM units) |
| Lab results | Observation (+ reference range and interpretation) |
| Lab / imaging orders | ServiceRequest |
| Queue entries | Task |
| Procedures | Procedure |
| Documents | DocumentReference |
| Data-sharing consent | Consent |
| Pregnancy | EpisodeOfCare |
| SHA transaction | Claim (use = claim / preauthorization / predetermination) |
| Any write | Provenance |

Mappers drop empty elements, because FHIR forbids empty strings, arrays and objects.

## Pipeline

```
consultation finalized ─► mappers ─► transaction Bundle ─► structural validation
   ─► FhirOutbox (idempotencyKey consultation:<id>:v<n>) ─► FHIR_SYNC job ─► DHA SHR write
```

* Each finalization or addendum produces a new version, so re-finalizing or retrying never
  creates duplicate outbox entries.
* Bundles that fail validation are stored with `status: failed` and their errors, and are not
  queued.
* The SHR write uses the contract operation `shr.records.write`. Until the owner configures its
  path from the HIE catalog, the job fails permanently and the entry becomes **`blocked`**. It is
  never marked `sent`.
* Interoperability → FHIR outbox lists entries with their status, validation result and payload,
  and can retry failed or blocked entries. A retry revalidates the payload first.

## Read API

`/api/v1/fhir/metadata`, `Patient/:id`, `Patient/:id/$everything`, `Encounter/:id`,
`Practitioner/:id`, `Organization`, `Location`, `outbox`, `outbox/:id`, `outbox/:id/retry`.
Every endpoint is RBAC-protected and branch-scoped.

The validator checks structure: required elements, cardinality, value sets for core codes,
reference and date formats. It does **not** check profile conformance. Passing it, or passing IG
validation, does not mean DHA certification.
