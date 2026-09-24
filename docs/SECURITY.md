# Security

* **Passwords**: bcrypt with cost 12. The policy is at least 10 characters, with upper case, lower
  case and a digit. An account locks for 15 minutes after 5 failed attempts.
* **Tokens**: HS256 JWT access tokens (15 min) with an audience per portal (`tenant`, `platform`,
  `support`). Refresh tokens are opaque random values. They are stored hashed, sent in an httpOnly
  `SameSite=Strict` cookie scoped to the auth path, and rotated on every use. Presenting a token
  that was already rotated revokes the whole session family. Sessions end after 30 minutes of
  inactivity. Logout, suspension and password reset revoke sessions immediately, because every
  request checks that the session is live.
* **CSRF**: the cookie endpoints (refresh) require `X-Requested-With: AfeySync`. The API itself
  uses bearer tokens.
* **Headers and limits**: Helmet, strict CORS (platform origins only), per-IP rate limits (login is
  stricter), and a 2 MB JSON limit.
* **Injection**: every request is validated with zod. Keys that start with `$` or contain `.` are
  stripped from bodies and query strings, and regex input is escaped.
* **Secrets**: `IntegrationSecretService` uses AES-256-GCM with a key ID so keys can be rotated
  (`INTEGRATION_ENCRYPTION_OLD_KEYS`). The UI only ever sees "configured" plus the last four
  characters. Pino log redaction covers authorization headers, cookies, passwords and tokens.
  Integration logs store request metadata only.
* **Patient data**: branch scoping, minimum-necessary duplicate responses (no name or ID across
  branches), an audited `patient.view`, and consent capture at registration.
* **Platform owner**: has no clinical access. Support access follows reason → facility approval →
  time limit → scoped permissions (no `admin.*`) → audit in both databases → revocable.
* **Callbacks**: each endpoint has a secret URL token (stored hashed) and optionally requires
  HMAC-SHA256 over the raw body. Events are deduplicated and persisted before they are processed.
* **MFA**: not implemented yet. Session and user models are ready for a second factor.
