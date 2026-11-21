# ADR-017: Server-side sessions for instant revocation, and TOTP two-step verification for staff

**Status:** accepted · **Date:** 2026-11-21 · **Area:** security (identity and access)

## Context

The last open security condition on the decision slide was "MFA and token revocation". The gaps were:
- a stolen access token stayed valid until it expired (60 minutes), and the only kill switch was rotating the signing secret, which signs everyone out (threats T-02, AP-3);
- deactivating a user did not stop their live token;
- staff, who can release compliance holds, approve reversals and reset other people's access, signed in with a password alone.

## Decision

1. **Every access token names a server-side session** (`auth_sessions`, migration 0004). On every request, HTTP and the live WebSocket, the session must exist, be unexpired and unrevoked, and belong to an active user. Revocation therefore takes effect on the **next request**:
   - sign out (`POST /v1/auth/logout`);
   - "sign out everywhere else";
   - signing out one listed session;
   - an administrator ending a person's sessions (SYSADMIN, reason audited);
   - an MFA reset;
   - deactivating the user.

   The check is one primary-key read, and the session's last-seen time is written at most once a minute. Onboarding's 30-minute APPLICANT tokens are the only exception.
2. **No silent re-login after revocation.** The demo console signs operators in with the shared demo password. A 401 that carries a revocation reason is remembered, so the console shows "Your session was ended (reason)" and waits for an explicit sign-in, which needs the code again when MFA is on.
3. **TOTP for staff roles** (OPS, COMPLIANCE, FINANCE, SYSADMIN, AUDITOR), RFC 6238: HMAC-SHA1, 6 digits, 30 s, ±1 step of drift. It is verified against the RFC test vectors (A1) and works with any authenticator app.
   - **Password, then challenge:** the right password yields only a 5-minute *challenge* token that no API endpoint accepts. The access token comes after the code.
   - **Replay protection:** each code works once (the last step used is stored).
   - **Brute-force limit:** 5 wrong codes per user per 5 minutes (ADR-016). Correct codes don't count.
   - **Secrets at rest:** AES-GCM with `PAYA_MFA_ENCRYPTION_KEY`, bound to the user id as associated data, so a copied secret cannot be decrypted under another account.
   - **Enrolment** shows the key once (QR plus text) and activates only after a correct code. Enrolling from a signed-in session ends that user's other password-only sessions.
4. **Policy.** A staff member who has enrolled *always* needs a code. With `PAYA_MFA_ENFORCED` (default: on outside demo mode), an un-enrolled staff member must set up an authenticator before getting any access token. In demo mode MFA is opt-in, so the scripted demo is unchanged. Customers are not in scope: their protection is device-bound sessions and screening (future: device binding).
5. **Administration:** SYSADMIN can end anyone's sessions or reset their MFA, with a reason in the audit chain, but **cannot reset their own** MFA.

## Consequences

- A stolen token can be killed in seconds, per person, without signing everyone out.
- The password alone no longer opens a staff account, once enrolled or when enforced.
- Each request costs one small indexed read.
- Still open:
  - tokens are still in browser `localStorage` (httpOnly cookies or OIDC are the production path);
  - there are no recovery codes (MFA recovery is an administrator reset after an identity check);
  - local JWT auth rather than an identity provider.

## Alternatives rejected

- **Short-lived tokens with a refresh token only:** revocation would still wait for expiry, and refresh rotation needs cookie storage the PWA does not have yet.
- **A JWT deny-list:** it needs the same database read as a session check, but cannot list or manage sessions.
- **SMS one-time codes:** they cost money, are vulnerable to SIM swap, and need a real phone number.
- **Enforcing MFA in demo mode:** the scripted demo switches between seven staff accounts; enforcement is demonstrated separately (`mfa_e2e.cjs`, enforced phase).
