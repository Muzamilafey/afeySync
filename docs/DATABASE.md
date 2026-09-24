# Database

MongoDB 6+ (replica set recommended in production). Models are in `backend/src/models/meta` and
`backend/src/models/tenant`.

## Key indexes

| Collection | Indexes |
|---|---|
| patients | `patientNumber` (unique), `nationalId`, `clientRegistryId`, `shaNumber`, `phone`, `searchName`, `identifiers.type+value`, `insurance.memberNumber`, `branchIds`, `createdAt` |
| shatransactions | `reference` (unique), `idempotencyKey` (unique), `externalReference`, `patientId`, `branchId`, `status`, `kind` |
| users | `email` (unique), `branchIds`, `status` |
| auditlogs | `action`, `resource`, `resourceId`, `createdAt` |
| meta.tenantdomains | `hostname` (unique), `tenantId` |
| meta.integrationconfigs | `scope+tenantId+provider` (unique) |
| meta.sessions | `tokenHash` (unique), `familyId`, TTL on `expiresAt` |
| meta.jobs | `idempotencyKey` (unique), `status+runAt` |
| meta.callbackevents | `dedupeKey` (unique), `externalReference` |

Patient numbers (`AFS-0000001`) come from an atomic counter in each tenant database. The prefix is
configurable per facility.

Audit collections are append-only. Update and delete hooks throw an error.
