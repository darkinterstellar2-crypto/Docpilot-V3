# Troubleshooting

## Common Issues

### "Session expired" after login

**Cause:** JWT secret changed between restarts (e.g., `JWT_SECRET` env var not set, and `.jwt-secret` file was deleted or not persisted).

**Fix:** Either set `JWT_SECRET` in `.env` or ensure `src/DataFiles/.jwt-secret` is persisted across restarts (Docker volume for `src/DataFiles/`).

### OTP not received via email

**Cause:** SMTP not configured or credentials invalid.

**Check:** Look at the server console — OTPs are always printed there:
```
=== NEW REGISTRATION ===
Email: user@example.com
OTP: 123456
========================
```

Use the console OTP for development. Fix SMTP settings for production.

### User cannot log in after approval

**Cause:** ACL entry with zero access was auto-created. The user needs project access.

**Fix:** In admin panel → Access Control, assign the user to at least one project with `access: true`.

### "Access denied: project not accessible"

**Cause:** User's ACL does not include access to the requested project.

**Fix:** Superadmin must update the user's ACL to include the project with `access: true`.

### Files missing from file browser

**Possible causes:**
1. **NAS cleanup removed them** — If NAS sync is enabled, files older than 48 hours are cleaned locally. They should auto-fetch from NAS on access.
2. **Path traversal protection** — Check that the path doesn't contain `..` or other suspicious characters.

**Fix:** If NAS is enabled, accessing the file should trigger on-demand fetch. If NAS is disabled, the file may be permanently gone. Check `.trash` for accidentally deleted files.

### "Row was modified by another user" (409 Conflict)

**Cause:** Another user (or browser tab) saved changes to the same row between when you loaded the data and when you tried to save.

**Fix:** Refresh the page to get the latest data, then make your changes again.

### Server crashes on startup

**Check:**
1. Node.js version (requires v18+, v22 recommended)
2. `npm install` completed successfully
3. `better-sqlite3` compiled correctly (needs build tools on some systems: `python3`, `make`, `g++`)
4. `STORAGE_ROOT` path is writable

### Docker container won't start

**Check:**
1. `docker compose logs docpilot` for error messages
2. Ensure `.env` file exists and has no syntax errors
3. Check volume mounts are accessible
4. Port 3000 is not already in use

### NAS sync not working

**Check:**
1. `NAS_SYNC_ENABLED=true` in `.env`
2. `NAS_WEBDAV_URL` is accessible from the server
3. WebDAV credentials are correct
4. `GET /api/admin/sync-status` shows `connected: true`
5. Check `errors` array in sync status

**Manual trigger:** `POST /api/admin/sync-trigger`

### Chat messages not loading

**Cause:** SQLite database issue (corrupted, locked, or permissions problem).

**Check:**
1. `storage/<Project>/chat/chat.db` exists
2. File has read/write permissions
3. No `.db-wal` or `.db-shm` lock files stale from a crashed process
4. `better-sqlite3` is installed correctly

### GeoCam not working

**Check:**
1. Browser supports `getUserMedia` and `Geolocation` APIs
2. Site is served over HTTPS (required for camera/GPS access)
3. User has granted camera and location permissions

### DoBo AI not responding

**Check:**
1. `AI_ENABLED=true` in `.env`
2. `AI_API_KEY` is set and valid (Gemini API key)
3. Server can reach `generativelanguage.googleapis.com` (no firewall blocking)
4. Check rate limiting — user may have hit the per-user limit
5. Check daily cost cap — may have been reached

## Debugging Tips

### Enable verbose logging

All HTTP requests are logged to the super log. Query recent errors:
```
GET /api/admin/super-logs?level=error&limit=50
```

### Check data file integrity

Aufmass data files are JSON. Validate with:
```bash
node -e "JSON.parse(require('fs').readFileSync('storage/Project/Doku/Aufmass/datafile/Project.txt','utf8')); console.log('Valid')"
```

### Reset a user's password

Edit `src/DataFiles/users.json` directly — set `password` to a plain text value. On next login, it will be auto-migrated to bcrypt.

### Clear NAS sync state

Delete `.sync-manifest.json` and `.sync-operations.json` from `STORAGE_ROOT` to force a full re-sync on next cycle.

## Known Limitations

- **No database server** — All data is in JSON files. Not suitable for very high concurrency.
- **No WebSocket** — Chat uses polling (fetch with `after` parameter), not real-time push.
- **No token blacklist** — Logout is client-side only. JWTs remain valid until expiry.
- **CORS wide open** — `cors()` allows all origins. Restrict in production.
- **Single process** — No clustering or horizontal scaling. One Node.js process handles everything.
- **No automated tests** — No test suite exists in the codebase.
- **calendar.html** is a design placeholder only — no JavaScript logic.
- **teams.html** is partial — loads users but no invite/role management UI.
