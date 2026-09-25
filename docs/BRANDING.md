# Facility branding

Each facility can brand its own address (`<facility>.afeysync.com`, or `<facility>.localhost:3000` in
development). The main AfeySync address and the owner portal keep the AfeySync look.

## What can be set

| Setting | Where it shows |
| --- | --- |
| Logo (PNG or JPEG, up to 512 KB) | Sign-in and password pages, app header, browser tab icon, installed app icon |
| Display name (defaults to the registered name) | Same places, and the installed app's name |
| Tagline | Under the name on the sign-in page; the installed app's description |
| Sign-in message | A short note on the sign-in page, for staff. Never put patient information here. |
| Brand colour | Buttons, links, the active menu item and the sign-in background, across the whole app |

Every page is marked "Powered by AfeySync".

## Who can change it

* Facility administrators (`admin.settings`): **Admin → Branding**.
* The platform owner, on the facility's behalf: **Owner → Facilities → (facility) → Branding**.

Changes are recorded in the facility audit trail or the platform audit log.

## Safeguards

* Branding is public because it appears before sign-in, so keep it to public information.
* Logos are checked from the file contents and only PNG/JPEG are accepted. SVG is refused because
  it can carry scripts. Logos are served with `nosniff` and a `default-src 'none'` policy.
* The colour must keep white button text readable (contrast ≥ 3:1). Colours that are too light are
  refused.
* A facility's logo is served only on that facility's own address.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET/PUT | `/api/v1/admin/branding` | Facility; body `{displayName?, tagline?, welcomeMessage?, primaryColor?}`, `""` clears a field |
| PUT/DELETE | `/api/v1/admin/branding/logo` | Facility; body `{dataBase64}` |
| GET/PUT, PUT/DELETE `/logo` | `/api/v1/owner/tenants/:id/branding` | Owner portal |
| GET | `/api/v1/auth/context` | Public; `branding` for facility addresses |
| GET | `/api/v1/auth/branding/logo?v=…` | Public; the logo for the current address, cached by version |

## Printed documents (letterhead)

Everything the facility prints starts with its letterhead: the logo, display name, legal name,
and the branch name, MFL code, address, phone and email. This covers receipts, invoices, lab
reports and discharge summaries, plus any HMIS page printed from the browser (reports, for example).

- The letterhead comes from `GET /api/v1/auth/letterhead`, which works for any signed-in user.
  The logo is returned inline as a data URL, so it also prints for users who signed in on the main
  address rather than the facility's subdomain. A token only returns its own facility's letterhead.
- The branch details are those of the active branch, or of the main branch if none is selected.
- When printing, the sidebar, top bar and on-screen controls are hidden, and the page always prints light (even from dark mode).
- The Print button on the document pages waits until the letterhead has loaded, so the logo is never missing.
- Upload or change the logo in **Admin → Branding**.
