# Authentication

DocPilot uses JWT-based authentication with email OTP verification and optional two-factor authentication (2FA). All auth logic lives in `routes/authRoutes.js` and `controllers/tokenHelper.js`.

## Roles

There are exactly **two roles**:

| Role | Description |
|------|-------------|
| `superadmin` | Full unrestricted access. Set manually in `users.json`. Cannot be assigned via UI. |
| `user` | Default role for all registrations. Access controlled entirely via ACL (see [Access Control](./access-control.md)). |

> **Important:** There is no "admin" role. The `superadmin` role is the only elevated role. Access granularity for regular users is handled through the ACL system, not through role assignment.

## Registration Flow

**File:** `routes/authRoutes.js` — `POST /api/register`

1. User submits: name, username, email, password
2. Server validates:
   - All fields are required
   - Password must be ≥ 8 characters
   - Email and username must be unique (checked against `users.json` AND pending registrations)
3. Password is hashed with bcrypt (12 rounds) via `passwordHelper.hashPassword()`
4. A 6-digit OTP is generated: `Math.floor(100000 + Math.random() * 900000)`
5. Registration data is stored **in memory only** (not saved to `users.json` yet)
   - Map: `pendingRegistrations` keyed by email
   - Auto-cleaned after 15 minutes
6. OTP is:
   - Printed to server console (for development)
   - Sent via email (Nodemailer SMTP)
7. Response: `{ success: true, message: "Verification code sent to email." }`

### OTP Verification

**`POST /api/verify-otp`**

1. User submits email + OTP code
2. Server checks `pendingRegistrations` map
3. If OTP matches:
   - User is **now** saved to `users.json` with `isVerified: true, isApproved: false`
   - Pending registration is removed from memory
   - Superadmin users receive an email notification about the new registration
4. If OTP doesn't match: returns error

### Admin Approval

After OTP verification, the user has `isApproved: false`. They cannot log in until a superadmin approves them via the admin panel (`POST /api/admin/approve`).

When approved:
- `isApproved` is set to `true`
- A zero-access ACL entry is auto-created (see [Access Control](./access-control.md))
- A welcome email is sent to the user

## Login Flow

**`POST /api/login`**

1. **Rate limiting:** `rateLimiter.checkAttempt(ip, identifier)` — 5 attempts per 15-minute window, then 15-minute lockout
2. **User lookup:** Find by email OR username
3. **Password verification:** `passwordHelper.verifyPassword(input, stored)` — supports both:
   - bcrypt hashes (`$2a$` / `$2b$` prefix)
   - Legacy plain text (returns `needsRehash: true` → auto-migrated to bcrypt)
4. **Security checks:**
   - `isVerified` must be `true` (email verified)
   - `isApproved` must be `true` (admin approved) — superadmin is exempt
5. **Two-Factor Authentication:**
   - If `user.twoFAEnabled === true`, OR if role is `superadmin` (unless explicitly `twoFAEnabled: false`)
   - Generate 6-digit OTP, store in `pending2FA` map (5-minute expiry)
   - Send OTP via email + print to console
   - Return `{ success: true, requires2FA: true, email }` — client shows 2FA input
6. **Token generation:** `tokenHelper.createToken(user)` — JWT signed with auto-generated secret

### JWT Token Details

**File:** `controllers/tokenHelper.js`

- **Payload:** `{ email, role, name, iat, exp }`
- **Duration:**
  - Regular users: 8 hours
  - Superadmin: 2 hours (stricter)
- **Secret:** Loaded from `JWT_SECRET` env var, or auto-generated and persisted to `src/DataFiles/.jwt-secret`
- **Algorithm:** Default HS256 (jsonwebtoken default)

### Token Refresh

**`POST /api/auth/refresh`**

- Checks if current token expires within 30 minutes
- If eligible: issues a new token with the same user data
- If not eligible (plenty of time left): returns `{ refreshed: false }`
- If expired: returns 401 — client must re-login

The frontend (`api.js`) automatically calls refresh before each API request when the token is near expiry.

## Auth Middleware

**`tokenHelper.authMiddleware`** — Applied to all `/api/*` routes (except geocode, which is mounted before it).

1. Extracts `Bearer <token>` from `Authorization` header
2. If valid: sets `req.user = { email, role, name }` and legacy headers (`x-user-email`, `x-user-role`, `x-user-name`)
3. If token exists but invalid/expired: returns `401 { tokenExpired: true }`
4. If no token: blocks `superadmin`/`admin` role claims in headers (prevents spoofing)

## Force Termination

Superadmins can force-terminate all sessions for a user via `POST /api/admin/terminate-session`.

- Adds user to `terminated-sessions.json`
- Middleware in `server.js` checks `isTerminated(email)` on every API request
- Terminated users get `401 { forceLogout: true }` — frontend clears localStorage and redirects to login
- Termination is cleared on next successful login (`clearTermination(email)`)

## Logout

**`POST /api/auth/logout`**

- Logs the logout event (session logger)
- **Token invalidation:** DocPilot does NOT maintain a server-side token blacklist. Logout is client-side (localStorage clear). The JWT remains valid until expiry. This is a known trade-off for simplicity.

## Frontend Auth

**File:** `src/js/auth.js`

- Handles login form submission, 2FA input, registration form, and OTP verification
- On successful login: stores `userRole`, `userName`, `userEmail`, `authToken` in `localStorage`
- Redirects to `index.html` (Hub)

**File:** `src/js/api.js`

- Global fetch interceptor
- Automatically injects `Authorization: Bearer <token>` on all `/api/` requests
- Auto-refreshes token when within 30 minutes of expiry
- Also sets legacy `x-user-email` and `x-user-role` headers for backward compatibility

**File:** `src/js/force-logout.js`

- Global fetch interceptor for 401 responses
- Detects `forceLogout` (admin terminated) or `tokenExpired` flags
- Clears localStorage, shows alert, redirects to login

**File:** `src/js/idle-logout.js`

- Inactivity auto-logout:
  - Regular users: 2 hours
  - Superadmin: 30 minutes
- Tracks last activity via localStorage (shared across tabs)
- Shows warning banner 2 minutes before logout
- Any interaction (click, keypress, scroll, touch, fetch) resets the timer
