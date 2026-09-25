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
