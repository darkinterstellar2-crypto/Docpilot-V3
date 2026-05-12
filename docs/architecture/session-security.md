# Session Security — Force Termination & Logout

> Added 2026-04-11. Allows superadmins to force-terminate any user's sessions across all devices.

---

## Architecture

### Storage
- **File:** `src/DataFiles/terminated-sessions.json`
- **Format:** `{ "email@example.com": { "at": "ISO-timestamp", "by": "admin@email" } }`

### Middleware (server.js)
- Runs on ALL `/api/` routes **except** `/api/auth/*` (login/register must work)
- Checks if the requesting user's email is in the terminated list
- Returns `401 + { success: false, forceLogout: true, message: "..." }` if terminated

### Lifecycle
1. Admin clicks ⏻ Terminate on user card → `POST /api/admin/terminate-session`
2. Server adds email to `terminated-sessions.json`
3. Logs `force_terminated` event in session logger + action log
4. **Every subsequent API call** from that user gets 401 + forceLogout
5. Client-side interceptor catches it → clears localStorage → redirects to login
6. When user logs in again → `clearTermination()` removes them from the list

### Client-Side: force-logout.js
- **Location:** `src/js/force-logout.js`
- **Included on:** ALL 14 authenticated HTML pages (admin, apl, aufmass, dashboard, druckprufung, einblasen, files, index, kalibrieren, knotenpunkt-vorbereitung, new-project, otdr, planner, profile)
- `idle-logout.js` is included on 15 pages (same 14 + superlog.html)
- Overrides `window.fetch` to intercept 401 responses
- On `forceLogout: true`:
  - Clears `userRole`, `userEmail`, `userName` from localStorage
  - Shows alert: "Your session has been terminated by an administrator."
  - Redirects to `login.html`

---

## API

### Terminate Session
```
POST /api/admin/terminate-session
Headers: x-user-email, x-user-role (superadmin required)
Body: { "email": "target@example.com" }
Response: { "success": true, "message": "All sessions for ... have been terminated." }
```

- **Superadmin only** (uses `superadminOnly` middleware)
- Can terminate ANY user including other superadmins and yourself
- No self-restriction (needed for compromised account scenarios)

---

## Compromised Account Recovery Flow

1. Log into admin panel (you're still authenticated)
2. Find the user card → click **⏻ Terminate** (confirm dialog)
3. Immediately click **Edit** on the same card → change password
4. The intruder's session is dead (all API calls return 401)
5. The old password no longer works (you changed it)
6. You log in with the new password → termination cleared automatically

If the compromised account is YOUR superadmin:
- Terminate yourself → you also get kicked out
- Change password via VPS terminal: `docker exec -it docpilot sh -c "apk add nano && nano /app/src/DataFiles/users.json"`
- Log back in with new password

---

## Superadmin Visibility

- Superadmin users ARE visible in the user list — but **only to other superadmins**
- Regular users/admins still cannot see superadmin accounts
- Route: `GET /api/admin/users` checks `x-user-role` header to decide visibility

---

## Security Layers (all implemented 2026-04-11)

| Layer | Status | Details |
|-------|--------|---------|
| Password hashing | ✅ Done | bcrypt (12 rounds), auto-migrates plain text |
| JWT session tokens | ✅ Done | 2h superadmin / 8h users, silent auto-refresh |
| Login rate limiting | ✅ Done | 5 attempts → 15 min lockout per IP+identifier |
| 2FA for superadmin | ✅ Done | Email OTP every login, 5 min expiry |
| Session termination | ✅ Done | Force-logout any user from all devices |
| Token auto-refresh | ✅ Done | Active users never expire; only idle sessions timeout |

### Remaining TODO
- Per-device session management (currently all-or-nothing termination)
- Password change requires current password verification
- User-visible session activity page ("where am I logged in?")
