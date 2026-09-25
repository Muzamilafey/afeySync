# Authentication: passwords, two-step verification and Google

Applies to both the facility app (`/api/v1/auth/*`) and the owner portal (`/api/v1/owner/auth/*`).

## Sign-in flow

```
password  ─┐                                   ┌─ second factor enrolled ──► challenge ──► session
           ├─► primary factor OK ──► policy ───┼─ required but none ──────► restricted session (enroll only)
Google    ─┘                                   └─ otherwise ──────────────► session
```

* Sessions are JWT access tokens plus rotating refresh cookies, as before. `Session.amr` records
  how the session was established (for example `password, totp` or `google, sms`).
* A **restricted session** (`rst: mfa_enroll`) is enforced by the API middleware. Only `/auth/me`,
  `/auth/logout` and `/auth/mfa/*` work until a method is enrolled. Enrolling lifts the
  restriction and returns a fresh access token.

## Two-step verification (MFA)

| Method | How | Notes |
|---|---|---|
| Authenticator app (TOTP) | RFC 6238, SHA-1, 6 digits, 30 s, ±1 step | Google Authenticator, Microsoft Authenticator, Authy… The secret is AES-256-GCM encrypted and `select: false`. Replay is blocked because a step can never be reused. |
| Email code | 6 digits via the `EMAIL` job queue | Uses the platform/facility SMTP. |
| SMS code | 6 digits via the `SMS` job queue | Uses Africa's Talking. Kenyan mobile numbers only. Facility portal only. |
| Passkey (WebAuthn) | Fingerprint, face, device PIN, phone or security key | Up to 10 per user, each named. The relying party is the exact host (facility subdomain, custom domain or owner portal), so a passkey only works where it was created. User verification is required. Only the public key and signature counter are stored; a counter that goes backwards (a cloned key) is refused. Both portals. |
| Recovery codes | 10 single-use codes, hashed | Issued when the first method is enabled. They can be regenerated with the password. |

* **Challenges** (`MfaChallenge`, meta DB) are single use and expire after 10 minutes. After 5
  wrong codes the challenge is locked. Codes can be resent at most 5 times, with a 30 s cooldown.
  An email or SMS code is bound to its method and challenge, and only its hash is stored. A passkey
  sign-in uses a fresh WebAuthn challenge that is cleared after one attempt, and the browser origin
  must be the same host over HTTPS (plain HTTP only on `localhost` in development). Login
  challenges are bound to the facility host (or the owner host) that created them.
* **Enrollment** always verifies a code (or, for a passkey, a signed WebAuthn registration) first.
  Facilities and the platform that had saved a policy before passkeys existed have passkeys added
  to their allowed methods once, by migration; admins can untick it in Security. Removing a method needs the password, and the last
  method cannot be removed while policy requires MFA. Every change sends a security email and is
  audited.
* **Policy**:
  * Facility: Admin → Security. The mode is `optional`, `admins` (anyone holding an `admin.*`
    permission) or `all`, and it sets the allowed methods.
  * Platform: Owner → Security. `admins` means super owners and platform admins.
* **Lost device**:
  * An administrator can reset a user's MFA (Users → Reset 2-step). A reason is required, the
    user's sessions are revoked and the user is emailed.
  * Owners can reset platform users.
  * When the owner resets a facility administrator's password, that also clears the admin's MFA.

## Sign in with Google (OpenID Connect)

* **Setup:** the platform owner configures Owner → Integrations → Google Sign-In:
  * the OAuth client ID and secret
  * the redirect URI, which defaults to `${API_URL}/api/v1/oauth/google/callback`. Register this
    exact URL in Google Cloud Console.
  * optionally, a Google Workspace domain restriction

  Each facility can turn Google sign-in off under Admin → Security.
* **Flow:**
  * Authorization-code flow with PKCE (S256), `state` and `nonce`. Endpoints come from Google's
    discovery document.
  * The ID token must be RS256 and verified against Google's JWKS, including after key rotation.
    `iss`, `aud`, `exp`, `nonce` and `email_verified` are all checked.
  * A single callback serves every facility. It returns the browser to the host that started the
    flow, which must match the request host, with a single-use completion code (2-minute expiry).
    Only that host can redeem the code, which sets the session cookie on the right domain.
* **Linking is explicit:** a signed-in user links Google from their account page. There is **no
  automatic linking by email address**, because that would let anyone who controls a matching
  Google address take over an account. Unlinking needs the password.
* **Second factor:** two-step verification still applies after Google sign-in, exactly as after a
  password.

## Password reset

See EMAIL.md. A reset revokes all sessions. MFA stays in place and is still required at the next
sign-in.
