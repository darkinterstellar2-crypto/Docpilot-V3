# Authentication & Access Control

> Complete reference for authentication, session management, security layers, and the ACL engine.
> Last updated: 2026-04-11

---

## Security Architecture Overview

DocPilot uses a layered security model:

| Layer | Mechanism | Details |
|-------|-----------|---------|
| **Passwords** | bcrypt (12 rounds) | Auto-migrates legacy plain text on first login |
| **Sessions** | JWT tokens | 2h superadmin / 8h users, auto-refresh for active users |
| **Brute force** | Rate limiter | 5 attempts → 15 min lockout per IP+identifier |
| **Superadmin** | 2FA (email OTP) | Required every login, 5 min expiry |
| **Termination** | Force-logout | Kick any user off all devices instantly |
| **Authorization** | Roles + ACL | Role-based (user/superadmin) + granular per-project per-module ACL |

### New Files (Security)

| File | Purpose |
|------|---------|
| `controllers/passwordHelper.js` | bcrypt hash + verify with legacy plain text migration |
| `controllers/tokenHelper.js` | JWT create, verify, refresh eligibility, Express middleware |
| `controllers/rateLimiter.js` | In-memory login rate limiter (IP + identifier key) |
| `src/js/api.js` | Client-side fetch interceptor: attaches JWT, auto-refreshes tokens |
| `src/js/force-logout.js` | Client-side fetch interceptor: detects 401 force-logout/token-expired |

### Dependencies

| Package | Purpose |
|---------|---------|
| `bcryptjs` | Password hashing (pure JS, no native compilation needed) |
| `jsonwebtoken` | JWT token creation and verification |

---

## Registration Flow

```
POST /api/register { name, username, email, password }

1. Validate:
   - All fields required
   - Role is always 'user' (no role selection — everyone registers as user)
   - Password: 8+ chars, strength indicator shown but no special char requirement
   - Email and username must be unique

2. Hash password with bcrypt (12 salt rounds)

3. Store in pending map (in-memory, 15 min expiry — NOT users.json yet):
   { name, username, email, password: "$2a$12$...", role: "user", otp: "483920", createdAt }

4. Send 6-digit OTP via email (also printed to console for dev testing)

5. Response: { success: true, message: "Verification code sent to email." }
```

### OTP Verification

```
POST /api/verify-otp { email, otp }

1. Check pending map for email
2. Verify OTP matches and hasn't expired (15 min)
3. Move user from pending map → users.json:
   { id, name, username, email, password (bcrypt), role: "user",
     isVerified: true, isApproved: false, createdAt }
   Note: OTP is NOT stored in users.json — it was only in the in-memory pending map.
   (Legacy entries created before this flow may have had otp: null stored; the fallback
   path in verify-otp still handles those for backward compatibility.)
4. Account now pending admin approval — cannot log in yet.

Response: { success: true, message: "Email verified! Waiting for admin approval." }
```

### Admin Approval

```
POST /api/admin/approve { email, status: 'approved' | 'revoked' }

- Sets isApproved = true/false
- Sends welcome email on first approval
- Revoke = lock out without deleting the account
```

---

## Login Flow

### Regular User (role: user)

```
POST /api/login { identifier, password }
  identifier = email OR username

Step 1 — Rate limit check:
  → checkAttempt(ip, identifier)
  → If locked out → 429 "Too many failed attempts. Try again in X minutes."

Step 2 — Find user:
  → By email or username in users.json
  → Not found → 401, recordFailure(), show remaining attempts

Step 3 — Verify password:
  → verifyPassword(input, stored) handles both bcrypt AND legacy plain text
  → If bcrypt hash: bcrypt.compare()
  → If plain text: direct comparison, returns { match: true, needsRehash: true }
  → Wrong password → 401, recordFailure(), show remaining attempts

Step 4 — Auto-migrate password (if needsRehash):
  → Hash with bcrypt, save to users.json
  → User never notices — silent upgrade

Step 5 — Verification checks:
  → isVerified === false → 403 "Please verify your email first"
  → isApproved === false → 403 "Account pending admin approval"

Step 6 — Success:
  → clearAttempts(ip, identifier)
  → clearTermination(email) — if previously force-terminated
  → createToken(user) → JWT with 8h expiry
  → Log to sessions-log.json + logs.json + superLogger
  → Return: { success: true, role, name, email, token: "eyJ..." }

Client stores:
  localStorage.authToken = token
  localStorage.userRole = role
  localStorage.userName = name
  localStorage.userEmail = email
```

### Superadmin Login (2FA required)

```
Steps 1-5 same as above.

Step 6 — 2FA trigger:
  → Generate 6-digit OTP
  → Store in pending2FA map (in-memory, 5 min expiry)
  → Email OTP to superadmin with IP + device info
  → Return: { success: true, requires2FA: true, email }
  → Client transforms login form → 2FA code input

Step 7 — 2FA verification:
  POST /api/verify-2fa { email, otp }
  → Check pending2FA map: exists? not expired? code matches?
  → If valid → clearTermination, createToken (2h expiry), return { token, role, name, email }
  → If invalid/expired → 400 error, must start over

2FA code email includes:
  - Subject: "🔐 DocPilot 2FA Verification Code"
  - IP address and device/user-agent of the login attempt
  - Warning: "If you did not attempt to log in, change your password immediately."
  - Code expires in 5 minutes.
```

---

## JWT Session Tokens

### Token Structure

```
Header: { alg: "HS256", typ: "JWT" }
Payload: { email, role, name, iat, exp }
Signature: HMAC-SHA256 with server secret
```

### Token Lifetime

| Role | Duration | Rationale |
|------|----------|-----------|
| `user` | 8 hours | Full work day coverage |
| `superadmin` | 2 hours | Higher privilege = stricter timeout |

### JWT Secret

Priority order:
1. `JWT_SECRET` environment variable
2. `src/DataFiles/.jwt-secret` file (auto-generated, gitignored)
3. Auto-generate 128-char random hex on first boot → persist to `.jwt-secret`

### Server-Side Middleware (`authMiddleware`)

Mounted on ALL `/api/` routes in `server.js`:

```
1. Extract token from: Authorization: Bearer <token>
2. If token present:
   a. Verify signature + expiry
   b. Valid → set req.user = { email, role, name }, set legacy headers for backward compat
   c. Invalid/expired → 401 + { tokenExpired: true }
3. If no token:
   → Fall through (legacy header-based auth still accepted during migration)
   → Once migration is complete, enforce token requirement here
```

### Client-Side Token Handling (`api.js`)

Global fetch interceptor loaded on every page (before all other scripts):

```
1. Intercepts every fetch() call to /api/*
2. Reads token from localStorage.authToken
3. Checks token expiry (client-side JWT decode):
   - If within 30 min of expiry → auto-refresh (see below)
4. Attaches Authorization: Bearer <token> header
5. Also attaches legacy x-user-email/x-user-role headers (backward compat)
```

### Silent Token Refresh

Prevents session expiry for active users. As long as someone is using the app, their session never dies.

**How it works:**

```
1. Before each API call, api.js decodes the JWT payload (client-side, no verification)
2. Checks: is exp within the next 30 minutes?
3. If yes → POST /api/refresh with current token
4. Server validates current token:
   - Expired → 401 (must re-login)
   - Valid but NOT within refresh window → { refreshed: false } (no action needed)
   - Valid AND within refresh window → issue fresh token with full duration reset
5. Client stores new token in localStorage, uses it for the actual request
6. Parallel protection: single shared Promise prevents concurrent refresh calls
```

**Net effect:** Active users stay logged in indefinitely. Sessions only expire after the full duration of **inactivity** (no API calls at all).

**Endpoint:**
```
POST /api/refresh
Headers: Authorization: Bearer <current-token>
Response (refreshed): { success: true, refreshed: true, token: "eyJ..." }
Response (not needed): { success: true, refreshed: false }
Response (expired): 401 + { tokenExpired: true }
```

---

## Rate Limiting

In-memory rate limiter (`controllers/rateLimiter.js`).

### Configuration

| Setting | Value |
|---------|-------|
| Max attempts | 5 failed logins |
| Lockout duration | 15 minutes |
| Sliding window | 15 minutes |
| Tracking key | `IP + identifier` (email or username) |

### Behavior

- Each failed login calls `recordFailure(ip, identifier)`
- Reaching 5 failures → locked out for 15 minutes
- Successful login calls `clearAttempts(ip, identifier)` → counter reset
- Stale entries auto-cleaned every 60 seconds
- Counter resets after window expires (even without successful login)

### Response When Locked

```json
{
  "success": false,
  "message": "Too many failed attempts. Try again in 15 minutes.",
  "retryAfterSec": 900
}
```

HTTP status: **429 Too Many Requests**

---

## Session Termination (Force-Logout)

Allows superadmins to instantly kick any user off all devices.

### Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| Storage | `src/DataFiles/terminated-sessions.json` | `{ "email": { "at": timestamp, "by": admin_email } }` |
| Middleware | `server.js` | Checks every `/api/` request (except `/api/auth/*`) |
| Client interceptor | `src/js/force-logout.js` | Detects 401 force-logout, clears storage, redirects |
| Admin UI | `admin.html` | ⏻ Terminate button on user card (superadmin only) |

### Flow

```
1. Superadmin clicks ⏻ Terminate on user card
2. POST /api/admin/terminate-session { email }
3. Server adds email to terminated-sessions.json
4. Every subsequent API call from that user → 401 + { forceLogout: true }
5. force-logout.js catches it → clears localStorage → alert → redirect to login
6. On next successful login → clearTermination(email) removes the flag
```

### Endpoint

```
POST /api/admin/terminate-session
Auth: superadmin only
Body: { email }
Response: { success: true, message: "All sessions for ... have been terminated." }

- Can terminate ANY user including other superadmins and yourself
- Self-termination needed for compromised account scenarios
```

### Compromised Account Recovery

```
1. Log in → Admin panel → Find user → ⏻ Terminate
2. Edit same user → Change password
3. Intruder is locked out (all API calls return 401)
4. Old password no longer works
5. Re-login with new password → termination cleared

If YOUR superadmin is compromised:
- Terminate yourself (you get kicked too)
- Change password via VPS: docker exec -it docpilot sh -c "nano /app/src/DataFiles/users.json"
- Log in with new password
```

---

## Client-Side Auth Scripts

### `api.js` — Token Attachment + Auto-Refresh

Loaded **first** on every page (before other scripts).

- Wraps `window.fetch`
- Attaches `Authorization: Bearer <token>` to all `/api/` requests
- Decodes JWT client-side to check expiry
- Auto-refreshes when within 30 min of expiry
- Also sends legacy `x-user-email`/`x-user-role` headers (backward compat)

### `force-logout.js` — Force-Logout Detection

Loaded on all **14** authenticated pages: admin, apl, aufmass, dashboard, druckprufung, einblasen, files, index, kalibrieren, knotenpunkt-vorbereitung, new-project, otdr, planner, profile.

> **Note:** `idle-logout.js` is loaded on **15** pages — the same 14 plus `superlog.html`. The superadmin-only superlog page still needs idle timeout but does not include `force-logout.js` since it is already superadmin-restricted.

- Wraps `window.fetch` (chains with api.js)
- Checks every response for `status === 401`
- On `forceLogout: true` → "Session terminated by administrator" → redirect
- On `tokenExpired: true` → "Session expired, please log in again" → redirect
- Clears all localStorage: `authToken`, `userRole`, `userEmail`, `userName`
- Single redirect guard prevents duplicate redirects

---

## Role System

### Roles

| Role | Value | Description |
|------|-------|-------------|
| Superadmin | `superadmin` | God-mode. Cannot be created via registration. Set directly in users.json. Requires 2FA. |
| User | `user` | Default for all registered users. Pure ACL-based access — zero access by default. |

> Only two roles exist: `user` and `superadmin`. There is no admin/administrator role. Access is controlled entirely through ACL permissions.

### Permission Matrix

| Action | user | superadmin |
|--------|------|------------|
| Register | ✅ | — (direct users.json) |
| Log in | ✅ | ✅ (+ 2FA) |
| View projects | ✅ (ACL filtered) | ✅ (all) |
| Read aufmass | ✅ (if ACL grants) | ✅ |
| Save aufmass | ❌ (unless canEdit) | ✅ |
| File operations | ❌ (unless canEdit) | ✅ |
| Use module pages | ❌ (unless ACL grants) | ✅ |
| Project chat | ✅ (if ACL grants) | ✅ |
| Create/delete projects | ❌ | ✅ |
| Admin panel | ❌ | ✅ |
| Approve users | ❌ | ✅ |
| Manage ACL | ❌ | ✅ |
| Super-logs | ❌ | ✅ |
| Session termination | ❌ | ✅ |

### Role Enforcement

- `authMiddleware` (server.js): validates JWT, sets `req.user`
- Route-level checks: `req.user.role` or legacy headers
- `requireNonUserRole` middleware: blocks `user` role on write routes
- `superadminOnly` middleware: blocks non-superadmin
- `USER_ROLE_BLOCKED_MODULES`: hard cap on module access for `user` role
- ACL engine: granular overrides within role boundaries
- Client-side redirects: defence-in-depth (backend always enforces too)

---

## Access Control (ACL) System

Granular per-user, per-project, per-module access control on top of the role system.

**Storage:** `src/DataFiles/access-control.json`

### Design Principles

1. **Superadmin bypasses ACL entirely** — never checked for `role === 'superadmin'`
2. **No ACL entry = zero access** for `user` role (changed from legacy "full access" default)
3. **`fullAccess` toggle** grants all project + module access for a user
4. **`canEdit`** grants file write operations (upload/rename/delete/copy/move/share)
5. **Role restrictions always win** — ACL cannot grant access beyond what the role allows
6. **Write mutex** — all read-modify-write operations use a `_writeLock` promise chain

### ACL Structure

```json
{
  "max@company.de": {
    "fullAccess": false,
    "canEdit": true,
    "projects": {
      "ProjectA": {
        "access": true,
        "canEdit": true,
        "modules": {
          "aufmass": true,
          "files": true,
          "druckprufung": false,
          "apl": true,
          "chat": true
        }
      }
    }
  }
}
```

### Access Resolution

**Project access:**
```
1. No ACL entry → depends on role defaults
2. fullAccess = true → all projects accessible
3. Explicit project entry: return entry.access
4. No explicit entry: denied
```

**Module access:**
```
1. Superadmin → always allowed
2. USER_ROLE_BLOCKED_MODULES check → hard deny for user role
3. ACL: project.modules[moduleName] check
4. fullAccess user → all modules
```

### Authority Permissions

> Updated 2026-04-12: Fixed authority permissions (were non-functional before this date).

Separate from project-level ACL. Controls admin-like abilities across all projects:

| Permission | Controls | Backend check |
|---|---|---|
| `createProject` | Create new projects | `canDashboard(email, 'createProject')` in `projectRoutes.js` |
| `deleteProject` | Delete projects | `canDashboard(email, 'deleteProject')` |
| `changeStatus` | Change project status | `canDashboard(email, 'changeStatus')` |
| `reorderProjects` | Drag-reorder projects | `canDashboard(email, 'reorderProjects')` |
| `downloadZip` | Download folder as ZIP | `canDashboard(email, 'downloadZip')` |
| `editProjectInfo` | Edit project details & team | `getEffectivePermissions()` → `auth.editProjectInfo` |

**Storage:** Saved under both `authority` and `dashboard` keys in ACL (backward compat).  
**Frontend:** `dashboard.js` reads `data.authority || data.dashboard` from `/api/access/my-permissions`.  
**Full Access:** Grants ALL authority permissions + ALL project access.  
**Superadmin:** Always bypasses all checks (first condition in every route).

**Admin panel behavior:**
- Full Access ON → red confirmation dialog, then enables all toggles
- Full Access OFF → disables all authority + project + module toggles
- Individual authority toggles → separate confirmation dialog per toggle

**Team member sync:** When ACL is saved, `project-info.json` members arrays are updated automatically. Granting project access → adds email to members. Removing access → removes from members.

- **`canEdit`** — full file operations (upload, rename, delete, copy, move, share)
- **Generator access** — per-user permission + code gate (two-layer auth)

### ACL Management API (superadmin only)

```
GET    /api/admin/access-control           → Full ACL object
GET    /api/admin/access-control/:email    → Single user's rules
POST   /api/admin/access-control/:email    → Set/replace rules
DELETE /api/admin/access-control/:email    → Remove all restrictions
```

### User Permission Query

```
GET /api/access/my-permissions?project=X
→ Returns module-level permissions for the requesting user
```

---

## Logout Flow

```
POST /api/logout { email }

1. Log session event (logout) to sessions-log.json
2. Return: { success: true }
3. Client clears localStorage: authToken, userRole, userName, userEmail
4. Redirect to login.html
```

---

## Session Tracking

### sessions-log.json

Tracks login, logout, login_failed, force_terminated events.

- **Location:** `src/DataFiles/sessions-log.json`
- **Max entries:** 10,000
- **Entry:** `{ email, name, action, timestamp, ip, userAgent, device }`
- **Device parsing:** Simple regex (OS + browser detection)

### API

```
GET /api/admin/user-sessions/:email   → session history + last login + devices
GET /api/admin/user-stats/:email      → aggregated stats (counts, last login/logout)
```

---

## localStorage (Client-Side State)

| Key | Value | Set on |
|-----|-------|--------|
| `authToken` | JWT string | Login success (or 2FA success for superadmin) |
| `userRole` | `user` / `superadmin` | Login success |
| `userName` | Full name | Login success |
| `userEmail` | Email address | Login success |

**Cleared on:** Logout, force-logout, token expiry.

---

## Security Upgrade History

| Date | Change |
|------|--------|
| 2026-04-11 | bcrypt password hashing with auto-migration |
| 2026-04-11 | JWT session tokens (2h/8h) |
| 2026-04-11 | Login rate limiting (5 attempts / 15 min lockout) |
| 2026-04-11 | 2FA for superadmin (email OTP) |
| 2026-04-11 | Session termination (force-logout all devices) |
| 2026-04-11 | Silent JWT token refresh (active sessions never expire) |
| 2026-04-05 | Role consolidation: only `user` + `superadmin` |
