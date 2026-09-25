# M-Pesa (Daraja)

Adapter: `backend/src/integrations/mpesa/mpesaService.ts`. Routes: `backend/src/modules/billing/mpesa.routes.ts`.

* **OAuth:** `GET /oauth/v1/generate?grant_type=client_credentials` (Basic auth), with token
  caching.
* **STK Push:** `POST /mpesa/stkpush/v1/processrequest`. The password is
  `base64(shortcode + passkey + timestamp)` and the timestamp uses EAT. The cashier starts it from
  an invoice with `POST /api/v1/payments/mpesa/stk`. That creates a `pending` Payment (idempotent),
  sends the prompt and returns immediately.
* **STK query:** `POST /api/v1/payments/mpesa/:paymentId/query`, for when a callback is late.
* **Callback:** `POST /api/v1/payments/mpesa/callback/:token`. The token is a per-facility secret
  in the URL and only its hash is stored. The callback is matched by `CheckoutRequestID`, handles
  duplicates idempotently, completes the payment, generates the receipt number, recalculates the
  invoice and queues an SMS receipt.
* **C2B (paybill/till):** register with `POST /api/v1/payments/mpesa/c2b/register`. Validation and
  confirmation arrive at `/payments/mpesa/c2b/:token/validation|confirmation`. Confirmed payments
  whose bill reference matches an invoice number are allocated to it. The rest are kept as
  `unallocated` for the cashier to allocate.
* **Reconciliation:** Billing → Reconciliation lists unallocated payments, and the cashier
  allocates each one to an outstanding invoice (audited).
* Owner configuration covers consumer key and secret, passkey, shortcode, till, paybill,
  environment (sandbox/production) and callback base URL. Owner → Integrations → M-Pesa can test
  the connection.
* B2C (refunds to phone) is **not** implemented. Refunds are recorded as credit notes and paid out
  by an approved method.
