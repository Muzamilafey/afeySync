# SMS (Africa's Talking)

* Configured by the owner: username, API key (encrypted), sender ID and environment (sandbox or
  production). A facility can use its own account only if the owner allows it.
* Sending: `POST /version1/messaging`. The connection test is `GET /version1/user`.
* Delivery goes through the `SMS` job type. Jobs are idempotent by key and retry with exponential
  backoff. Configuration errors and invalid numbers go straight to the dead-letter queue, where the
  owner can review and retry them under Owner → Jobs.
* Patient messages respect `patient.consent.sms`. A clinical transaction never fails because an
  SMS could not be queued.

Current triggers:

| Event | Message |
|---|---|
| Appointment booked | Confirmation, plus a reminder scheduled before the appointment |
| M-Pesa payment confirmed | Receipt number and M-Pesa reference |
| Lab results verified | "Your laboratory results are ready" (no results in the SMS) |
| ANC visit | Next visit date |
| Immunization given | Next vaccine due date (KEPI schedule) |
| Family planning visit | Return date |
| Discharge | Discharge notice |

SMS never contains diagnoses, results or other clinical details.
