# Email (SMTP)

* The owner configures host, port, username, password (encrypted), encryption
  (none/starttls/ssl), from name and from email. A facility can use its own SMTP only if the owner
  allows it.
* **SEND TEST EMAIL** is under Owner → Integrations → SMTP (`kind: email`).
* Messages go through the `EMAIL` job type with idempotent keys, retries and a dead-letter queue.
