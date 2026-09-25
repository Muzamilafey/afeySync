# Facility self-registration (onboarding)

New facilities register themselves at **`/get-started`**. The page is linked from every facility
sign-in page ("New to AfeySync? Register your facility"), and the bare platform domain
(`PLATFORM_DOMAIN`, e.g. `afeysync.com`) redirects to it.

```
Plan → Facility → Web address & branches → Administrator → Modules → Review
     → email code → submitted ─┬─ owner approves → facility provisioned → sign-in link emailed
                               └─ owner rejects  → reason emailed
```

## Applicant experience

* A seven-step wizard with a progress rail, per-step validation that mirrors the server, a live
  web-address availability check (with suggestions when taken), up to 10 branches, a password
  strength checklist and a review page with "Edit" links.
* The draft is kept in the browser (never the password) so a refresh does not lose work. After
  submission the application reference and a private status token are kept, so the applicant can
  come back to the status page.
* Email ownership is proved with a 6-digit code (15 min, 5 attempts, 5 sends, 30 s resend
  cooldown). Unverified applications are deleted after 48 hours.
* Plans (Free trial, Basic, Standard, Premium) set the **trial limits** (branches, users). Every
  facility starts on a 30-day trial; pricing is agreed with the AfeySync team, not shown here.

## Owner review (Owner Portal → Registrations)

* Lists applications awaiting review, approved and rejected, with full details, the verified
  administrator email and the source IP.
* **Approve & create facility** reuses the standard provisioning (database, web address, default
  roles, catalogs, subscription) and creates the administrator with the password they chose (stored
  only as a bcrypt hash until then, and removed from the application afterwards). The chosen
  modules switch on the facility's integration flags; credentials are still configured separately.
* **Reject** requires a reason, which is emailed to the applicant and shown on their status page.
* **Approval mode**: *Manual review* (default) or *Automatic after email verification*, which
  provisions the facility as soon as the email is confirmed. Changing it needs `owner.platform`.
* Owners and platform admins are emailed when a new registration is submitted.

## Safeguards

* Public endpoints are rate limited like sign-in and reveal only whether a web address is free.
* Reserved addresses (`www`, `owner`, `api`, `admin`, …) can never be registered; an address is
  held while its application is under review and re-checked before approval.
* One open application per administrator email.
* All decisions are recorded in the platform audit log.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/onboarding/config` | Platform domain, approval mode, plan limits |
| GET | `/api/v1/onboarding/slug?slug=&name=` | Availability, reason, suggestion |
| POST | `/api/v1/onboarding/applications` | Creates an unverified application and emails a code; returns `applicationToken` once |
| POST | `/api/v1/onboarding/applications/resend` | New code |
| POST | `/api/v1/onboarding/applications/verify` | Confirms the email; submits (or provisions in automatic mode) |
| POST | `/api/v1/onboarding/applications/status` | Status for the applicant (token in the body, never in the URL) |
| GET/PUT | `/api/v1/owner/onboarding/settings` | Approval mode |
| GET | `/api/v1/owner/onboarding/applications` | Review queue (`status`, `q`) |
| POST | `/api/v1/owner/onboarding/applications/:id/approve` | Optional `plan` |
| POST | `/api/v1/owner/onboarding/applications/:id/reject` | `reason` required |
