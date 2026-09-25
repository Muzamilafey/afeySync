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

## Available to every facility

SMS works for every facility on every plan. There is no per-facility SMS switch: all facility SMS
(appointment reminders, payment receipts, results notices, sign-in codes and so on) go through the
platform SMS gateway set up in Owner → Integrations. The only exception is a facility the owner
allows to use its own gateway account. The facility's gateway choice (Automatic / Africa's Talking /
Talksasa) still applies.

## SMS wallet

Each facility pays for its SMS from a prepaid **SMS wallet**. One credit is one SMS segment:
160 characters, or 153 per part for longer messages; 70/67 for messages with emoji or non-Latin
characters.

* **Welcome gift:** every facility gets **20 free SMS** once, when it is created. Facilities that
  already existed get them at the next start-up.
* **Top-up with M-Pesa** (Admin → SMS wallet): an STK prompt to the payer's phone, or Paybill using
  the owner's business number and the facility's account number `SMS<FACILITY>` (e.g.
  `SMSNDABIBI`). Payments go to the owner's collection channel (Integrations → M-Pesa (AfeySync
  billing)). They are credited only from Safaricom's confirmation, once per M-Pesa receipt, at the
  price shown when the top-up was started.
* **Charging:** credits are taken when an SMS is sent and returned automatically if the gateway
  fails. When the wallet is empty, ordinary SMS stop (the job is dead-lettered with a clear reason).
  Sign-in codes may use a small reserve (default 5) so nobody is locked out; it is recovered at the
  next top-up.
* **Reminders to top up:** administrators (users who can view the subscription or manage settings)
  get an in-app notification and an email once when the balance is low (default 5 SMS or fewer) and
  once when it is empty. The dashboard shows a banner until they top up. Alerts re-arm after each
  top-up.
* **Owner** (Owner → SMS): price per SMS (default KES 1), welcome credits, low-balance level,
  minimum top-up, sign-in reserve, every facility's balance and usage, and manual adjustments (for
  example a paybill payment sent with the wrong account number). Every change is recorded in the
  wallet history and the audit log.
* Facilities using their own SMS account are not charged.

Sign-in codes are never stored in plain text: queued SMS and email codes are encrypted and wiped
once sent.

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

## Admission phone verification

When admitting a patient (Inpatient → Admit patient), staff confirm the patient's phone:

* A 6-digit code goes by SMS to the patient, the next of kin, or another number typed in (that
  number can be saved to the patient's record once verified). Staff enter the code the patient reads
  back.
* Codes are stored only as a hash and sent encrypted through the queue. They expire in 10 minutes
  and allow 5 attempts. Resends are limited (30 seconds apart, 10 per patient per hour).
* A correct code gives a single-use verification that only works for the same patient and the same
  staff member, within 30 minutes.
* When a code is not possible (patient unconscious, no phone, phone not with them, no network,
  minor without a guardian's phone, or another stated reason), staff record the reason instead.
  **Emergency care is never blocked.**
* The result (verified, or skipped with the reason) is stored on the admission and in the audit
  trail.
* Setting: Admin → Security → Admission phone verification: **Required** (default: a code or a
  recorded reason), **Optional** or **Off**. Codes are paid from the SMS wallet like any other SMS.
