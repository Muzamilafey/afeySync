# SMS (Africa's Talking and Talksasa)

AfeySync can send SMS through two gateways. Each is set up once by the owner under
**Owner → Integrations**, then switched on per facility.

## Gateways

**Africa's Talking**
* Settings: username, API key (encrypted), sender ID, environment (sandbox or production).
* Sending: `POST /version1/messaging`. Connection test: `GET /version1/user`.

**Talksasa** (Bulk SMS API v3, `https://bulksms.talksasa.com/api/v3`)
* Settings: API base URL, sender ID (approved by Talksasa, up to 11 characters) and API token
  (encrypted, sent as `Authorization: Bearer …`).
* Sending: `POST /sms/send` with `{ recipient, sender_id, type: "plain", message }`. Numbers are
  sent without `+`; local forms such as `0712…` become `254712…`.
* Talksasa can report a failure in the response body (`{"status":"error"}`), even with HTTP 200.
  AfeySync treats that as a failure and never marks the message as sent.
* Connection test: `GET /balance`. The owner portal shows the SMS units and can send a test SMS.
* Environment variables for first start: `TALKSASA_API_TOKEN`, `TALKSASA_SENDER_ID`,
  `TALKSASA_BASE_URL`. They are imported once into Owner → Integrations; manage them there
  afterwards.

## Which gateway a facility uses

Choose under **Owner → Facilities → (facility) → Integrations → SMS gateway**:

| Choice | Behaviour |
|---|---|
| Automatic (default) | Africa's Talking when it is enabled for the facility, otherwise Talksasa |
| Africa's Talking | Only Africa's Talking |
| Talksasa | Only Talksasa |

The fallback happens only when a gateway is not set up. AfeySync never retries a failed message on
the other gateway, so a patient is never sent the same SMS twice. A facility can use its own
account for either gateway only if the owner allows it.

## Delivery
* Delivery goes through the `SMS` job type. The job result records which gateway sent it. Jobs are idempotent by key and retry with exponential
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
