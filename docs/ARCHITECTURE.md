# Architecture

```
Browser (facility app / owner portal)
   │  same-origin /api/*   (never calls SHA/DHA/M-Pesa directly)
   ▼
nginx ──► Next.js (UI)            ──► /api proxied to the API with X-Forwarded-Host
   └────► Express API (TypeScript)
            ├─ middleware: requestId → helmet/CORS → sanitize → tenant resolver → auth → RBAC → branch scope
            ├─ modules: auth, owner, branches, users/roles, admin, patients, dha, sha, callbacks, dashboard, notifications
            ├─ integrations: hie (DHA/SHA adapter), mpesa, africastalking, smtp
            ├─ jobs: queue abstraction (Mongo today, BullMQ-ready) + handlers
            └─ MongoDB
                 ├─ afeysync_meta              (platform: tenants, domains, integration configs, logs, sessions, jobs)
                 └─ afeysync_tenant_<slug>     (one per facility: patients, users, roles, branches, audit, SHA records …)
```

## Request lifecycle

1. `requestId` assigns or propagates `X-Request-Id`.
2. `resolveTenantHost` maps the hostname (platform subdomain, verified custom domain or branch
   domain) to a tenant through `TenantDomain`, with a 60 s cache. The owner hostnames are marked as
   owner hosts.
3. `authenticateTenant` or `authenticatePlatform` verifies the JWT and checks that the session is
   still live. It then enforces tenant/host consistency and loads the user, roles and permissions
   from the **tenant database**. It also resolves the active branch (`X-Branch-Id`) against the
   user's branch scope. After this step the request carries `req.tenant`, `req.user`, `req.branch`
   and `req.permissions`.
4. `requirePermission(...)` guards each route. Queries use `branchFilter(req)` and
   `assertBranchAccess`.
5. Errors use one envelope, `{ success: false, error: { code, message, requestId } }`, and never
   include stack traces or secrets.

## Integration layering

```
External provider API  ←  Adapter (hieClient: token, contract, retries, logs)
                       ←  Service (DHAClientRegistryService, SHAEligibilityService, …)
                       ←  Controller (RBAC, validation, audit, persistence)
                       ←  UI
```

Operation methods and paths come from `IntegrationContract`, which the owner can edit. A
documentation change does not require an HMIS code change.
