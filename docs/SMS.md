# SMS (Africa's Talking)

* Configured by the owner: username, API key (encrypted), sender ID and environment (sandbox or
  production). A facility can use its own account only if the owner allows it.
* Sending: `POST /version1/messaging`. The connection test is `GET /version1/user`.
* Delivery goes through the `SMS` job type. Jobs are idempotent by key and retry with exponential
  backoff. Configuration errors and invalid numbers go straight to the dead-letter queue, where the
  owner can review and retry them under Owner → Jobs.
* Use cases (OTP, appointments, payments, lab results, reminders) are triggered by the modules that
  own those events. Those triggers are wired up as each module is built.
