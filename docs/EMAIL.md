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
