# RBAC

* The permission catalog is in `backend/src/modules/rbac/catalog.ts`. It uses
  `module.action` keys, for example `patients.create`, `sha.claim`, `admin.users` and
  `dha.registry`.
* **Platform** permissions (`owner.*`) come from the platform user's role (`super_owner`,
  `platform_admin` or `platform_support`). They are never valid inside a tenant.
* **Tenant** roles live in each tenant database. The 30 default roles (Facility Owner, Doctor,
  Receptionist, SHA Officer and so on) are seeded as `system` roles. Custom roles are supported.
* **Scope**: a role is either `tenant` (tenant-wide) or `branch`. A user has
  `branchAccess: all | specific` plus `branchIds`. Any role with tenant scope gives the user
  tenant-wide access.
* **Escalation guards**: nobody can create or assign a role containing permissions they do not
  hold. Branch administrators cannot assign tenant-scope roles or manage users outside their
  branches. The built-in administrator roles are immutable, and users cannot change their own
  roles or status.
* **Enforcement is server-side**: `requirePermission` / `requireAnyPermission` on routes, and
  `branchFilter` / `assertBranchAccess` on queries. The UI hides what a user cannot do, but it
  enforces nothing on its own.
