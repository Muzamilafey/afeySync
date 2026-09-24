# Multi-tenancy

* **Meta database** (`afeysync_meta`) holds: `PlatformUser`, `Tenant`, `TenantDomain`,
  `TenantDatabase`, `TenantSubscription`, `IntegrationConfig`, `IntegrationContract`,
  `IntegrationLog`, `CallbackEndpoint`, `CallbackEvent`, `PlatformAuditLog`, `Session`,
  `PlatformSettings`, `SupportAccessGrant` and `Job`.
* **Tenant databases** (`afeysync_tenant_<slug>`) are created by the provisioning service. Each one
  holds only its own facility's data. Connections use `useDb`, so all tenants share one pool while
  every query is physically scoped to its own database. `getTenantConnection` refuses any database
  name that lacks the tenant prefix.

## Tenant resolution

1. Authenticated session: the token carries `tid`.
2. Hostname: `<slug>.<PLATFORM_DOMAIN>`.
3. Verified custom domain or branch domain (`TenantDomain`, confirmed by a DNS TXT record).

When a hostname maps to a tenant, the token's `tid` **must** match it, otherwise the request fails
with `TENANT_MISMATCH`. Tenant IDs sent by the client (headers, query or body) are ignored.
Facility tokens are rejected on owner hosts, and owner tokens are rejected on facility hosts.

## Provisioning (Owner → Facilities → New)

The steps run in order: tenant → database record → indexes → permissions and 30 default roles →
branches → administrator (temporary password, must change at first login) → domains →
subscription → default settings → `active`. If any step fails, everything created in that attempt
is rolled back, including dropping the new database.

## Tests

`backend/tests/isolation.test.ts` tries to reach Tenant B's patient, claim, SHA eligibility,
DHA annotations, branch and credentials using a Tenant A user and token. Every attempt is blocked.
