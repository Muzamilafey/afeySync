# Email (SMTP)

* The owner configures host, port, username, password (encrypted), encryption
  (none/starttls/ssl), from name and from email. A facility can use its own SMTP only if the owner
  allows it.
* **SEND TEST EMAIL** is under Owner → Integrations → SMTP (`kind: email`).
* Messages go through the `EMAIL` job type with idempotent keys, retries and a dead-letter queue.

Current uses:

* **Password reset:** `POST /api/v1/auth/forgot-password` always returns the same response,
  whether or not the account exists. The link carries a random token that is stored hashed, is
  single use and expires after 30 minutes. `POST /api/v1/auth/reset-password` sets the new
  password, revokes every session and clears any lockout.
* Security notices, such as a changed password.

## Which mail server is used

1. The facility's own SMTP, if the owner allows facility credentials and the facility has enabled it.
2. Otherwise the platform SMTP from **Owner → Integrations → SMTP Email**.
3. Otherwise the `SMTP_*` variables in the API `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
   `SMTP_PASSWORD`, `SMTP_ENCRYPTION`, `SMTP_FROM`). Port 465 uses SSL automatically.

Security emails (two-step codes, password resets, onboarding codes) never fail just because a
facility has not set up its own email. When no mail server is configured at all, the email job fails
with a message saying what to set, visible in the API log and in Owner → Jobs & Queues, where failed
jobs can be retried after fixing the settings.

## Design

Every email uses the AfeySync layout (`backend/src/modules/notifications/emailLayout.ts`):

* the **AfeySync HMIS** wordmark, with the facility's name under it (or "Hospital Management
  Information System" for platform emails)
* a title, a greeting ("Hello …,"), then the message
* sign-in and verification codes in large, letter-spaced type, followed by "This code expires in … and
  can only be used once"
* detail rows (for example sign-in address and username) and a button for links, with the link also
  written out in case the button does not work
* a "Didn't request this?" note that includes the support contact when `SUPPORT_EMAIL` /
  `SUPPORT_PHONE` are set
* "Warm regards," with a sign-off, and a footer: "© <year> AfeySync HMIS. All Rights Reserved.",
  plus any `EMAIL_FOOTER_LINKS` (for example website and social pages). Nothing is shown for links
  that are not configured.

Emails that only pass plain text are wrapped in the same layout automatically, so every email looks
the same. A plain-text version is always sent as well.

Codes never go in the subject line, and code emails are queued encrypted (`textEnc` / `htmlEnc`) and
wiped after sending, so no code is ever stored in plain text. This includes the facility registration
code, which previously was not encrypted.
