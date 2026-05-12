# 2026-04-11 — Security Overhaul

**Time:** 03:36 – 03:50 AM (Europe/Berlin)
**Commits:** `08fa904` → `a73f5e5` (4 commits)
**Trigger:** Security incident — unauthorized access to a user account with saved credentials

---

## 1. bcrypt Password Hashing (`08fa904`)

### Problem
Passwords stored in plain text in `users.json`.

### Solution
- **bcryptjs** with 12 salt rounds for all password operations
- `controllers/passwordHelper.js`: `hashPassword()`, `verifyPassword()`
- **Auto-migration:** `verifyPassword()` detects plain text vs bcrypt hash
  - If plain text matches → returns `{ match: true, needsRehash: true }`
  - Caller auto-upgrades to bcrypt and saves to `users.json`
  - Zero downtime — existing users log in normally, passwords upgrade silently
- **Registration:** passwords hashed before storing (even in pending map)
- **Admin edit:** password changes hashed via `hashPassword()` before saving

### Files
- `controllers/passwordHelper.js` (new)
- `routes/authRoutes.js` — login + register updated
- `routes/adminRoutes.js` — admin password edit updated
- `package.json` — `bcryptjs` dependency

---

## 2. JWT Session Tokens (`a2435a7`)

### Problem
Auth was purely header-based (`x-user-email`, `x-user-role`). Anyone who modifies localStorage or intercepts a request can impersonate any user, including superadmin.

### Solution
- **jsonwebtoken** for server-side session management
- `controllers/tokenHelper.js`: `createToken()`, `verifyToken()`, `authMiddleware()`
- **Token payload:** `{ email, role, name, iat, exp }`
- **Expiry:**
  - Superadmin: **2 hours**
  - Regular users: **8 hours**
- **JWT secret:** Auto-generated 64-byte hex on first boot, persisted in `src/DataFiles/.jwt-secret` (gitignored)
  - Can be overridden via `JWT_SECRET` env var

### Auth Flow
1. Login success → server returns `{ ..., token: "eyJ..." }`
2. Client stores `token` in `localStorage.authToken`
3. `api.js` interceptor adds `Authorization: Bearer <token>` to every `/api/` request
4. `authMiddleware` in server.js validates token, sets `req.user` + legacy headers
5. On expiry → 401 + `{ tokenExpired: true }` → client redirects to login

### Backward Compatibility
- Legacy `x-user-email`/`x-user-role` headers still work alongside JWT
- `authMiddleware` sets legacy headers from decoded token for existing route checks
- Once migration is proven stable, legacy header path can be disabled

### Files
- `controllers/tokenHelper.js` (new)
- `server.js` — middleware mounted
- `routes/authRoutes.js` — returns token on login
- `src/js/api.js` — sends Authorization header
- `src/js/auth.js` — stores authToken
- `src/js/force-logout.js` — handles tokenExpired + clears authToken
- `.gitignore` — `.jwt-secret` excluded

---

## 3. Login Rate Limiting (`5308241`)

### Problem
No brute force protection — unlimited login attempts.

### Solution
- `controllers/rateLimiter.js`: in-memory rate limiter
- **Tracking key:** IP + identifier (email or username)
- **Config:**
  - `MAX_ATTEMPTS`: 5 failed attempts
  - `LOCKOUT_DURATION`: 15 minutes
  - `WINDOW_MS`: 15 minute sliding window
- Returns HTTP **429** when locked out with `retryAfterSec`
- Remaining attempts logged in action log + super log
- Cleared on successful login
- Auto-cleanup of stale entries every 60 seconds

### API Response (when locked)
```json
{
  "success": false,
  "message": "Too many failed attempts. Try again in 15 minutes.",
  "retryAfterSec": 900
}
```

### Files
- `controllers/rateLimiter.js` (new)
- `routes/authRoutes.js` — check + record + clear integrated

---

## 4. 2FA for Superadmin (`a73f5e5`)

### Problem
Superadmin has unrestricted access — password alone is insufficient.

### Solution
- **Every superadmin login** requires email OTP verification (no persistent sessions)
- **Flow:**
  1. Superadmin enters correct password
  2. Server generates 6-digit OTP, stores in `pending2FA` map (5 min expiry)
  3. OTP emailed to superadmin's registered email
  4. Server returns `{ success: true, requires2FA: true }`
  5. Client transforms login form to 2FA code input
  6. User enters code → `POST /api/verify-2fa`
  7. On match → JWT token issued, login complete
- Regular users skip 2FA entirely — direct login

### 2FA Code Input UI
- Centered 6-digit input with monospace font, letter-spacing
- 🔐 icon + "Two-Factor Verification" heading
- Error display for invalid/expired codes
- "Code expires in 5 minutes" notice
- `inputmode="numeric"` for mobile keyboard

### Security Email
- Subject: "🔐 DocPilot 2FA Verification Code"
- Includes: IP address, device/user-agent
- Warning: "If you did not attempt to log in, change your password immediately."

### Endpoint
```
POST /api/verify-2fa
Body: { email, otp }
Response: { success, role, name, email, token }
Errors: 400 (invalid/expired/missing)
```

### Files
- `routes/authRoutes.js` — pending2FA map, login 2FA trigger, verify-2fa endpoint
- `src/js/auth.js` — `show2FAInput()`, `completeLogin()` functions

---

## 5. Silent Token Refresh (`95b3585`)

### Problem
Field workers could have their session expire mid-upload after 8 hours. JWT expiry with no refresh = lost work.

### Solution
- `checkRefreshEligible()` in tokenHelper.js: checks if token is valid but within 30 min of expiry
- `POST /api/auth/refresh` endpoint: validates current token, issues fresh one with full duration reset
- `api.js` updated: before each API call, decodes JWT client-side to check `exp`
  - If within 30 min of expiry → auto-fires refresh before the actual request
  - Single shared Promise prevents concurrent refresh calls from parallel requests
  - Skips refresh endpoint itself to prevent loops

### Net Effect
- Active users stay logged in indefinitely — session only expires after full duration of **inactivity**
- No user interaction required — completely silent
- Field workers can work all day without interruption

### Files
- `controllers/tokenHelper.js` — `checkRefreshEligible()` added, exported
- `routes/authRoutes.js` — `/api/auth/refresh` endpoint
- `src/js/api.js` — client-side JWT decode + auto-refresh logic

---

## New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `bcryptjs` | latest | Password hashing (pure JS, no native build) |
| `jsonwebtoken` | latest | JWT token creation and verification |

---

## New Files

| File | Purpose |
|------|---------|
| `controllers/passwordHelper.js` | bcrypt hash + verify with legacy migration |
| `controllers/tokenHelper.js` | JWT create + verify + Express middleware |
| `controllers/rateLimiter.js` | In-memory login rate limiter |
| `src/DataFiles/.jwt-secret` | Auto-generated JWT secret (gitignored, runtime) |

---

## Security Summary

| Layer | Before | After |
|-------|--------|-------|
| Passwords | Plain text in JSON | **bcrypt** (12 rounds), auto-migration |
| Sessions | localStorage headers (spoofable) | **JWT tokens** with server validation |
| Session expiry | Never | **2h superadmin / 8h users** |
| Brute force | No protection | **5 attempts → 15 min lockout** |
| Superadmin auth | Password only | **Password + email OTP (2FA)** |
| Session termination | Not possible | **Force-logout from all devices** |
| Token refresh | N/A | **Silent auto-refresh** (active users never expire) |

---

## Full Commit List (2026-04-11 — both sessions)

### Session 2: Features (02:10 – 03:09)
1. `bf3956a` — Eigentümerdaten column + APL customer details
2. `2f1f729` — APL splice auto-fill + date/time + Time subcolumn
3. `7f11501` — Einblasen start/end meter, date/time, fiber colour
4. `497a03e` — APL splice confirm/update flow with logging
5. `a83662d` — Einblasen fiber colour fix (not pre-filled)
6. `781cf24` — Fiber type → Fiber count rename

### Session 2: Session Security (03:09 – 03:36)
7. `96afe97` — Session termination feature
8. `baeaa71` — Allow terminating own session
9. `b29a095` — force-logout.js on missing pages
10. `c3f1bf1` — Superadmin visibility in user list

### Session 2: Security Overhaul (03:36 – 03:50)
11. `08fa904` — bcrypt password hashing with auto-migration
12. `a2435a7` — JWT session tokens with expiry
13. `5308241` — Login rate limiting
14. `a73f5e5` — 2FA for superadmin

### Session 3: Token Refresh (11:34 – 12:08, same day)
15. `95b3585` — Silent JWT token refresh (active sessions never expire)
