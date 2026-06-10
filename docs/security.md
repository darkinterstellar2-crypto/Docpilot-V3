# Security

## Authentication Security

- **Password hashing:** bcrypt with 12 salt rounds (`controllers/passwordHelper.js`)
- **JWT tokens:** Auto-generated 64-byte hex secret, persisted to `.jwt-secret` with mode `0o600`
- **Session duration:** 8 hours (regular users), 2 hours (superadmin)
- **Token refresh:** Automatic 30-minute pre-expiry refresh
- **2FA:** Optional for users, default-on for superadmin (6-digit OTP via email, 5-minute expiry)

## Rate Limiting

### Login Rate Limiter (`controllers/rateLimiter.js`)
- Max 5 failed attempts per 15-minute window (per IP + identifier combo)
- 15-minute lockout after limit exceeded
- In-memory tracking, auto-cleaned every 60 seconds
- Cleared on successful login

### AI Rate Limiter (`controllers/aiRateLimiter.js`)
- Per-user sliding window
- Applied to all `/api/ai/*` routes

### Geocode Rate Limiter (`routes/geocodeRoutes.js`)
- Max 30 requests per minute per IP
- In-memory, cleaned every 5 minutes

### Edit Request Rate Limiter
- Max 5 edit requests per hour per user (AI edit-request forwarding)

### File Upload Daily Limit
- Max 5 AI file uploads per day per user

## Path Traversal Prevention

All file operations use `safePath()` to resolve and validate paths:

```javascript
function safePath(projectName, subPath) {
    const root = getProjectRoot(projectName);
    const resolved = path.resolve(root, subPath || '');
    if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
        return null; // traversal attempt
    }
    return resolved;
}
```

This prevents `../` attacks. All file routes, module routes, and share routes use this check.

Additional protections:
- Multer filenames are sanitized: `path.basename(file.originalname).replace(/[/\\]/g, '_')`
- AI upload project names validated: `/^[A-Za-z0-9_\- ]{1,100}$/`

## Static File Protection

Server-side files are blocked from public access via middleware in `server.js`:

```javascript
const blocked = [
    '/server.js', '/package.json', '/package-lock.json', '/dockerfile',
    '/docker-compose.yml', '/.gitignore', '/.dockerignore', '/caddyfile',
    '/controllers', '/routes', '/storage', '/src/datafiles',
    '/docs', '/.env', '/node_modules',
];
```

`express.static` also has `dotfiles: 'deny'` and no-cache headers for JS/CSS.

## Input Validation

- **Request body size:** 10 MB global limit (50 KB for AI routes)
- **File upload size:** 200 MB per file (50 MB for chat media, 10 MB for AI uploads, 2 MB for avatars, 5 MB for team pictures)
- **Chat media types:** Allowed extensions only (jpg, png, gif, webp, mp4, mov, avi, webm, pdf, doc, docx, xls, xlsx)
- **Registration:** Password minimum 8 characters
- **Admin user update:** Password minimum 4 characters, username minimum 3 characters

## AI Security (`controllers/aiSecurity.js`)

20 injection pattern detections + 8 output leak filters:

**Input sanitization:**
- System prompt override attempts
- Role injection
- Data extraction attempts
- Path traversal in prompts
- Jailbreak patterns

**Output filtering:**
- API key/secret patterns
- File system paths
- Database query patterns
- Server internal patterns

**Abuse detection:**
- Per-user injection tracking
- Escalating warnings
- Temporary bans

## CORS

```javascript
app.use(cors());
```

CORS is set to allow all origins (`*`). This is a known security consideration — in production, this should be restricted to the specific domain.

## Session Security

- **Force termination:** Superadmins can terminate any user's sessions immediately
- **Idle logout:** Auto-logout after inactivity (2h users, 30min superadmin)
- **Token-based auth only for elevated roles:** Without a valid JWT, `superadmin` or `admin` role claims in headers are stripped

## Share Link Security

- Cryptographically secure tokens: 9 random bytes → base64url (12 characters)
- Expiry-based (default 7 days, max 30 days)
- Access count tracking
- Path traversal protection within shared folders
- Expired links return 410; non-existent return 404

## Data File Protections

- `.filemeta.json` and `.trash` are protected from deletion
- Trash items have 30-day auto-expiry
- NAS cleanup never deletes unsynced files or canonical data files
- ACL write operations use a promise-chain mutex to prevent race conditions
