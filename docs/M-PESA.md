# M-Pesa (Daraja)

Implemented in `backend/src/integrations/mpesa/mpesaService.ts`:

* OAuth: `GET /oauth/v1/generate?grant_type=client_credentials` (Basic auth), with token caching.
* STK Push: `POST /mpesa/stkpush/v1/processrequest`. The password is
  `base64(shortcode + passkey + timestamp)` and the timestamp uses EAT.
* Owner configuration covers consumer key and secret, passkey, shortcode, till, paybill,
  environment (sandbox/production) and callback URL. Owner → Integrations → M-Pesa can test the
  connection.

**Not built yet:** the billing and cashier module that starts payments, the callback receiver with
idempotent receipt generation, C2B validation and confirmation, transaction lookup and
reconciliation. B2C must be explicitly authorized before it is added.
