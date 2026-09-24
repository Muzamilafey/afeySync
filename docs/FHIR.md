# FHIR R4

**Status: not implemented yet.** This document describes the planned design.

* Target profiles: Kenya Core FHIR IG (v1.0.0, FHIR 4.0.1). It is the foundation layer for the
  domain IGs: eClaims, ePrescription, Patient Summary, Emergency and NCCP.
* Planned mappings: AfeySync Patient → Kenya Core Patient, Facility → Organization, Staff →
  Practitioner/PractitionerRole, Visit → Encounter, Diagnosis → Condition, Lab/Radiology order →
  ServiceRequest, Workflow → Task, Document → DocumentReference, plus Observation, Procedure,
  Consent, EpisodeOfCare, Provenance, RelatedPerson, Location and Device.
* Pipeline: clinical write → mapper → validation (structure, profile, identifiers, references,
  terminology) → `FHIRSyncOutbox` → queue (`FHIR_SYNC`, idempotent per resource version) → SHR
  write → sync status.
* Passing FHIR validation does **not** mean DHA certification.
