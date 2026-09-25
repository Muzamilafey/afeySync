# Plans, modules and platform billing

This covers how the platform owner (AfeySync) sells subscriptions to facilities. Patient billing inside
a facility is a separate module.

## Plans & modules (Owner → Plans & Modules)

* A plan has a key and a name, prices per month, quarter and year (0 means “price on request”),
  a one-off setup fee, branch and user limits, free trial days, highlights for the registration
  page, and flags for active, offered at registration and “most popular”.
* **Core modules** are in every plan: patients, front desk and appointments, OPD, billing,
  documents and administration.
* **Optional modules**, switched on per plan: laboratory, radiology, pharmacy and inventory,
  procurement, inpatient, maternity/MCH/FP, dental, mortuary, finance, HR, reports, SHA, DHA HIE and
  FHIR, private insurance, and M-Pesa.
* **Enforcement is on the server.** Every facility API call to a module outside the plan is
  refused with `403 MODULE_NOT_IN_PLAN`, and the facility sidebar hides those modules. Changes to a
  plan apply to its facilities within 30 seconds.
* Tenants whose plan key is not in the catalogue (created before plans existed) keep every module.
* Default plans (Free trial, Basic, Standard, Premium) are seeded once with no prices, and are
  never overwritten afterwards.
* Changing a facility's plan in Owner → Facilities → Subscription applies that plan's limits,
  unless you enter limits yourself.

## Quotations, invoices and service agreements (Owner → Billing)

* **Numbering:** `QUO-2026-0001`, `INV-2026-0001` and `AGR-2026-0001`, sequential per year.
* **Customer:** a facility (its registered details are used by default) or a prospect.
* **Lines:**
  * Subscription lines use the plan price for the chosen cycle.
  * When a subscription invoice is **paid in full**, the facility's subscription is extended
    automatically: plan, status active, and months added from the current paid-until date.
* **Totals** are always calculated on the server. VAT (default 16%) applies only when you are
  VAT-registered, and the invoice is then titled “Tax Invoice”. Submission to KRA eTIMS is **not**
  automated.
* **Lifecycle:** `draft → issued → (accepted | declined) → partially_paid → paid`, or `void`.
  * Drafts carry a DRAFT watermark and are never shown to the facility.
  * A document can't be issued with a zero total.
  * Issued documents are locked. To change one, void it and create another. Paid or part-paid
    invoices cannot be voided.
* **Automatic signing:**
  * Upload your signature, company stamp and logo (PNG/JPEG, ≤ 1 MB) and your signatory's name
    and title in **Billing → Settings**.
  * When a document is issued, the current signature and stamp are applied and the business
    details are frozen.
  * A SHA-256 fingerprint of the content is printed on the PDF.
  * Replacing an image later affects only documents issued after that; older versions are kept.
  * With automatic signing on, documents can't be issued until a signature is uploaded.
* **Service agreements:**
  * Generated from an editable template: `## ` lines become headings, and placeholders such as
    `{{customer.name}}`, `{{plan.name}}`, `{{fee}}` and `{{startDate}}` are filled in.
  * The PDF includes a subscription schedule (plan, modules, limits, fee, term) and signature
    blocks for both parties.
  * The default template covers services, term, fees, data protection (Data Protection Act 2019),
    confidentiality, support, suspension without deleting records, termination and data return,
    liability and Kenyan law. **Have it reviewed by your advocate before use.**
* **Email:** the signed PDF is sent as an attachment through the platform SMTP settings.

## Facility side (Administration → Subscription)

* Current plan, status, paid-until date and days left, branch and user usage against limits, and
  included and locked modules.
* **Get quotation** for any priced plan and cycle: a signed quotation is issued instantly.
* **Review & accept** quotations and agreements. Acceptance records name, title, email, time and
  IP address. An accepted quotation becomes an issued invoice straight away.
* **Pay with M-Pesa:** an STK prompt is sent to the phone, and the page updates when Safaricom
  confirms the payment.
* Permissions: `subscription.view`, and `subscription.manage` to pay or accept (facility owner
  and admin). Branch admins can view only.

## M-Pesa collections (production)

Configure your own Daraja app in **Owner → Integrations → M-Pesa collections** (`mpesa_billing`).
It is platform-only: facilities can never see or change it.

1. Environment `production`, your shortcode, transaction type (`CustomerPayBillOnline` for a
   paybill or `CustomerBuyGoodsOnline` for a till, plus the till number), and the paybill number to
   print on invoices. Add the consumer key and secret and the Lipa na M-Pesa passkey; they are
   encrypted at rest.
2. `API_URL` must be the public **HTTPS** address of the API. Live payments are refused otherwise,
   because Safaricom only calls HTTPS callbacks.
3. **Billing → Settings → Register paybill URLs** registers the C2B confirmation and validation
   URLs. Validation only takes effect if Safaricom has enabled it on your shortcode.

How payments are applied:

* **STK push:** one pending prompt per invoice every 2 minutes; whole shillings only.
* **Callbacks:**
  * Success is recorded only from Safaricom's callback, which carries the receipt. A status query
    can only mark a payment as failed.
  * Callbacks are idempotent.
  * M-Pesa receipt numbers are unique across all payments, so a duplicate delivery is never counted
    twice.
* **Paybill (C2B):** the account number is the invoice number (`INV-2026-0001`, `INV20260001` or
  similar). Payments that don't match an invoice are kept as *unallocated* in Billing → Payments
  so you can allocate them.
* **Manual payments** (bank, cheque, cash, paybill) need a reference. An M-Pesa receipt can't be
  recorded twice.
* Every owner action is recorded in the platform audit log.
