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
| Multi-tenancy: meta DB + one database per facility, hostname/custom-domain resolver | ✅ |
| Authentication: JWT access tokens, rotating refresh sessions with reuse detection, lockout, idle timeout | ✅ |
| RBAC: permission catalog, 30 default roles, custom roles, branch scoping, privilege-escalation guards | ✅ |
| Append-only audit trail (tenant + platform) | ✅ |
| Owner portal: dashboard, facilities, 8-step provisioning wizard, domains, subscriptions, health, support access | ✅ |
| Integration credential manager (AES-256-GCM, platform → tenant priority, masked in UI) | ✅ |
| DHA HIE adapter: OAuth token caching and renewal, contract-driven operations, retries, integration logs | ✅ |
| Client Registry patient search and import, duplicate protection | ✅ |
| SHA eligibility, benefits, interventions, utilization, facility bed occupancy | ✅ |
| SHA authorization/preauth/claim drafts (idempotent) and verified status callbacks | ✅ (submission waits for operation paths, see below) |
| Patient registration/search/profile, front desk | ✅ |
| Branch, user and role administration; facility integration page; support-access approvals | ✅ |
| Queue abstraction (Mongo-backed, DLQ) with SMS / email / callback handlers | ✅ |
| M-Pesa Daraja adapter (OAuth, STK push) | Adapter only. Billing/cashier endpoints are not built yet |
| OPD, inpatient, maternity, MCH, lab, radiology, pharmacy, dental, mortuary, billing, inventory, procurement, finance, HR | Not started |
| FHIR R4 mappers + outbox, SHR, terminology UI, ePrescription, emergency | Operations are declared in the contract. Mappers are not built yet |

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

The suite covers authentication, refresh-token reuse detection, RBAC and escalation, **tenant
isolation** (Tenant A user vs. Tenant B patient, claim, DHA record, SHA record, credentials and
branch), **branch isolation**, support access, the DHA/SHA adapter (token caching, 401 renewal,
retries, headers, error mapping, not-configured operations), callbacks (HMAC, dedupe, matching) and
secret encryption.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Multitenancy](docs/MULTITENANCY.md) · [RBAC](docs/RBAC.md) ·
[Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [SHA](docs/SHA.md) · [DHA](docs/DHA.md) ·
[FHIR](docs/FHIR.md) · [M-Pesa](docs/M-PESA.md) · [SMS](docs/SMS.md) · [Email](docs/EMAIL.md) ·
[Deployment](docs/DEPLOYMENT.md) · [Owner portal](docs/OWNER-PORTAL.md) · [Branches](docs/BRANCHES.md) · [API](docs/API.md)
