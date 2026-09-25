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

## Signing in on the main domain

Staff can sign in at the platform's main address (`afeysync.com`, or `localhost:3000` in
development) as well as their facility's own address. The main address is `PLATFORM_DOMAIN` (and
`www.`), the host of `FRONTEND_URL`, and this computer's own `localhost`/`127.0.0.1` (in any `NODE_ENV`), so the
main page works locally even when `PLATFORM_DOMAIN` is set to the production domain. Facility links
are built on the same base the user is browsing (`localhost` → `<facility>.localhost`).

* The email and password are checked against every facility where that email has an account. The
  lookup uses a directory that stores only a hash of each email. It is filled in when users are
  created and rebuilt at start-up.
* The same lockout rules apply as on the facility's own sign-in page. An unknown email and a wrong
  password get the same answer.
* With one facility, the browser goes straight to `https://<facility>.afeysync.com/login` with a
  one-time handoff code in the URL fragment. The code is never sent in a request URL, works once,
  is bound to that facility and expires after 2 minutes. With several facilities, the user picks
  one.
* The facility page exchanges the code, then continues exactly like a normal sign-in: two-step
  verification or passkey if enabled, and the forced password change if one is pending.
* The facility address uses the same scheme and port as the main page, so it works on
  `http://<slug>.localhost:3000` during development.

## Two-step verification (MFA)

| Method | How | Notes |
|---|---|---|
| Authenticator app (TOTP) | RFC 6238, SHA-1, 6 digits, 30 s, ±1 step | Google Authenticator, Microsoft Authenticator, Authy… The secret is AES-256-GCM encrypted and `select: false`. Replay is blocked because a step can never be reused. |
| Email code | 6 digits via the `EMAIL` job queue | Uses the platform/facility SMTP. |
| SMS code | 6 digits via the `SMS` job queue | Uses the facility's SMS gateway (Africa's Talking or Talksasa). Kenyan mobile numbers only. Facility portal only. |
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

## New accounts and first sign-in

* When a facility administrator creates a user, or the owner creates a facility, the new person gets
  a welcome email. It gives the facility's sign-in address, their email (username), their role, and
  a **Choose your password** link. The link works once, expires in 72 hours, and only works on that
  facility's address. Passwords are never emailed.
* The administrator still sees a temporary password, as a fallback if the email does not arrive or
  email is not set up. The screen says which case applies.
* Until a new or reset account chooses its own password, the API refuses everything except the
  password change, profile, two-factor and sign-out endpoints (`PASSWORD_CHANGE_REQUIRED`). The app
  shows only the password screen. The API enforces this; the app is not the only guard.
* When an administrator (or the owner, for a facility admin) resets a password, the user is emailed
  a fresh link (valid 24 hours), and any earlier unused links stop working.
* Email goes through the facility's SMTP, the platform SMTP, or the `SMTP_*` settings in the API
  `.env`, in that order.

## My profile and Security (every user)

Every facility user has two pages, in the sidebar under **My account** and in the user menu:

* **My profile** (`/account/profile`): name, sign-in email, phone, roles, branches, cadre and licence,
  and their own leave. Users can change their **name and phone** only. Email, roles, branches and
  licence details are managed by an administrator (Admin → Users & Roles → Edit).
* **Security** (`/account/security`):
  * a summary of the account's protection
  * change password
  * two-step verification: authenticator app, email, SMS or passkeys
  * link Google
  * **Where you're signed in**: every device, with sign-out for one device or all others
  * **Recent security activity**: sign-ins, failed attempts, password and two-step changes

API: `GET/PATCH /api/v1/auth/profile`, `GET /api/v1/auth/sessions`,
`POST /api/v1/auth/sessions/:id/revoke`, `POST /api/v1/auth/sessions/revoke-others`,
`GET /api/v1/auth/activity`. Users only ever see and change their own account.
