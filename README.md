# AfeySync

AfeySync is a multi-tenant Hospital Management Information System (HMIS/EMR) for Kenyan
facilities. Each facility gets its own database. Branches of a facility share that database. The
platform owner runs everything from a separate portal and has no clinical access by default.
SHA and DHA HIE integrations go through a server-side adapter. The browser never calls them.

```
AfeySync Platform ──┬── Owner Portal (owner.afeysync.com)       → afeysync_meta
                    └── Tenant Facilities (<slug>.afeysync.com / custom domains)
                           └── Branches (tenantId + branchId)  → afeysync_tenant_<slug>
```

## What is implemented

| Area | Status |
|---|---|
| Multi-tenancy: meta DB + one database per facility, hostname/custom-domain resolver, tenant schema migrations | ✅ |
| Authentication: JWT access tokens, rotating refresh sessions with reuse detection, lockout, idle timeout, email password reset | ✅ |
| Two-step verification (passkeys, authenticator app, email, SMS, recovery codes) with facility/platform policies; Sign in with Google (explicit linking) | ✅ |
| RBAC: permission catalog, 30 default roles, custom roles, branch scoping, privilege-escalation guards | ✅ |
| Append-only audit trail (tenant + platform) | ✅ |
| Plans with per-plan modules (enforced by the API), owner quotations, invoices and service agreements as PDFs signed automatically with the owner's stamp and signature, M-Pesa collections (STK and paybill) that extend subscriptions | ✅ |
| Installable app (PWA) for facilities and the owner portal: install prompt, iOS instructions, offline page, update notice; patient data never cached | ✅ |
| Facility self-registration at `/get-started` (email-verified, owner review or automatic approval) | ✅ |
| Owner portal: dashboard, facilities, provisioning wizard, domains, subscriptions, health, jobs, backups, support access | ✅ |
| Integration credential manager (AES-256-GCM, platform → tenant priority, masked in UI) | ✅ |
| DHA HIE adapter: OAuth token caching and renewal, contract-driven operations, retries, integration logs | ✅ |
| Client Registry search/import, SHA eligibility, benefits, interventions, utilization, bed occupancy | ✅ |
| SHA claims: from invoice, FHIR Claim preview, submit, decisions, interventions, resubmission, remittance reconciliation; verified callbacks | ✅ (submission needs operation paths, see below) |
| Front desk: registration, visits, queues with tickets, appointments with SMS, emergency, referrals | ✅ |
| OPD: triage/vitals with flags, consultations (draft → final → addenda), procedures | ✅ |
| Laboratory (catalog, reference ranges, accession, verification by a second person) and radiology (MWL worklist, reports) | ✅ |
| Pharmacy (FEFO dispensing, allergy check), inventory, procurement (PO approval, GRN) | ✅ |
| Inpatient/nursing, maternity (ANC, partograph, delivery), MCH (KEPI), family planning, dental, mortuary | ✅ |
| Billing & cashier (price lists, invoices, payments, refunds, credit notes), M-Pesa STK/C2B, B2C refund payouts | ✅ |
| Finance (expenses with second approver, cash summary, receivables aging), HR (staff, leave, roster, licences) | ✅ |
| Reports (clinical, finance, supply, productivity) with audited CSV export | ✅ |
| Documents (content-sniffed uploads, audited downloads, soft delete) | ✅ |
| FHIR R4 mappers, validator, idempotent outbox to DHA SHR | ✅ (SHR write needs its operation path) |
| Encrypted per-database backups with run tracking | ✅ |
| DHA terminology browser, ePrescription (MedicationRequest/Dispense), emergency-claim protocols and doctors | ✅ (need their HIE operation paths) |
| SHA eClaims visit workflow: consent (OTP / biometric / minor), start visit, interventions, preauthorization, effective coverage, deceased block, per-facility FR code | ✅ (paths from the spec must be confirmed; claim-step paths must be entered) |
| Private insurance via Slade360 / HealthCloud: payers, coverages, eligibility, OTP, start visit, reservation, ICD-10 claims, invoices, attachments, credit notes, remittances, reconciliation, dashboard | ✅ (facility credentials; confirm paths in the sandbox) |

**External API rule:** the HIE operations whose paths come from the DHA documentation are
configured by default: token, Client Registry `GET /patients`, eligibility, benefits,
interventions, utilization and bed occupancy. All other HIE operations are *declared* but have no
path. AfeySync refuses to call them (`INTEGRATION_OPERATION_NOT_CONFIGURED`) until the platform
owner enters each path from the current official API catalog (https://hie-docs.dha.go.ke/) in
**Owner → API Config**. AfeySync never guesses endpoints.

**Certification:** a connected integration does **not** mean the system is DHA/SHA certified. Configuring an integration, testing it in UAT and getting regulatory certification are three separate steps.

## Repository layout

```
backend/    Express 5 + TypeScript + Mongoose API (tests: vitest + supertest)
frontend/   Next.js 16 + React 19 + Tailwind 4 (facility app + owner portal)
deploy/     nginx, PM2 and encrypted backup scripts
docs/       Architecture, security, integration and operations documentation
```

## Quick start (development)

```bash
# 1. MongoDB 6+ running locally
cd backend && cp .env.example .env    # fill JWT_SECRET, JWT_REFRESH_SECRET, INTEGRATION_ENCRYPTION_KEY
npm install
AFS_OWNER_PASSWORD='ChangeMe12345' npm run seed:owner -- --email owner@example.com
# Windows PowerShell:  $env:AFS_OWNER_PASSWORD='ChangeMe12345'; npm run seed:owner -- --email owner@example.com
npm run dev                            # http://localhost:4000, Swagger at /api/docs

cd ../frontend && cp .env.example .env.local   # OWNER_HOSTS=owner.localhost for dev
npm install && npm run dev             # http://owner.localhost:3000 and http://<slug>.localhost:3000
```

In development, set `PLATFORM_DOMAIN=localhost` and `OWNER_HOSTS=owner.localhost`. Browsers resolve
`*.localhost` to 127.0.0.1, so each facility gets its own subdomain (for example
`famzahra.localhost:3000`) and no hosts-file edits are needed.

## Tests

```bash
cd backend && npm test      # needs MongoDB on 127.0.0.1:27017 (or TEST_MONGO_URI)
```

The suite (187 tests) covers authentication, two-step verification (TOTP vectors, replay, lockout, policy enforcement, WebAuthn passkeys with origin binding and counter checks), Google OIDC (PKCE, token verification, no auto-linking), password reset, refresh-token reuse detection, RBAC
and escalation, **tenant isolation** (Tenant A user vs. Tenant B patient, claim, DHA record, SHA
record, credentials and branch), **branch isolation**, support access, the DHA/SHA adapter (token
caching, 401 renewal, retries, headers, error mapping, not-configured operations), callbacks (HMAC,
dedupe, matching), secret encryption, billing and M-Pesa idempotency, clinical workflows (queues,
immutable consultations, lab verification, FEFO dispensing, wards, maternity), documents, finance
and HR segregation of duties, reports and CSV safety, FHIR mapping and outbox, the SHA claim
lifecycle, the SHA eClaims visit workflow, Slade360 insurance (eligibility, reservation locking, ICD-10
mapping, server-side invoice totals, reconciliation), ePrescription, emergency claims, M-Pesa B2C payouts
and backup monitoring.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Multitenancy](docs/MULTITENANCY.md) · [RBAC](docs/RBAC.md) ·
[Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [SHA](docs/SHA.md) · [DHA](docs/DHA.md) · [Insurance](docs/INSURANCE.md) · [Onboarding](docs/ONBOARDING.md) · [Plans & billing](docs/BILLING.md) · [Installable app](docs/PWA.md) ·
[FHIR](docs/FHIR.md) · [M-Pesa](docs/M-PESA.md) · [SMS](docs/SMS.md) · [Email](docs/EMAIL.md) ·
[Authentication](docs/AUTHENTICATION.md) · [Deployment](docs/DEPLOYMENT.md) · [Owner portal](docs/OWNER-PORTAL.md) · [Branches](docs/BRANCHES.md) · [API](docs/API.md)
