# AI Integration (DoBo)

DoBo ("Document Bot") is DocPilot's built-in AI assistant. It provides context-aware help to users based on the current page, project, and user permissions.

> **⚠️ Current Status:** DoBo was removed from production because it was causing usability issues. The code remains in the codebase but the feature is not actively used.

## Architecture

DoBo consists of 9 backend controllers, 1 route file, 5 frontend JS files, and 1 HTML page.

### Backend Controllers

| File | Purpose |
|------|---------|
| `aiController.js` | Main orchestration — combines provider, security, knowledge, cost tracking, memory |
| `aiProvider.js` | Swappable model abstraction (Gemini + Anthropic) |
| `aiSecurity.js` | Input sanitization (20 injection patterns), output filtering (8 leak filters), abuse detection |
| `aiRateLimiter.js` | Per-user request rate limiting |
| `aiCostTracker.js` | Daily cost caps and usage tracking |
| `aiKnowledge.js` | Static app knowledge base (what DocPilot is, module descriptions) |
| `aiDataProvider.js` | Live project data reader (read-only, ACL-checked) |
| `aiMemory.js` | Per-user, per-project file-based memory |
| `aiMailer.js` | Edit request forwarding (DoBo → admin email) |

### Frontend Files

| File | Purpose |
|------|---------|
| `ai-widget.js` | Floating chat widget |
| `ai-chat.js` | Chat UI and message handling |
| `ai-context.js` | Context manager (current page, module, step) |
| `ai-face.js` | Animated bunny face |
| `ai-thoughts.js` | Thought bubble animations |
| `dobo-loader.js` | DoBo iframe loader |

## Dual-Model System

DoBo supports two AI models that users can toggle between:

| Mode | Model | Use Case |
|------|-------|----------|
| ⚡ Light | Gemini 2.5 Pro (default) | Fast responses, general help |
| 🧠 Heavy | Claude Sonnet 4 (Anthropic) | Complex thinking, detailed analysis |

Configured via environment variables:
```env
AI_API_KEY=your-gemini-key         # Light mode
AI_MODEL=gemini-2.5-pro

AI_API_KEY_ANTHROPIC=your-key      # Heavy mode  
AI_MODEL_PRO=claude-sonnet-4-20250514
```

### Model Fallback (Gemini)

The Gemini provider has a 3-model fallback chain:
1. Primary model (e.g., `gemini-2.5-pro`)
2. `gemini-2.5-flash`
3. `gemini-2.5-flash-lite`

Each model gets 2 retry attempts with exponential backoff before falling back.

## Safety Constraints

DoBo is **strictly read-only**:

- ✅ Can read project context (passed from frontend)
- ✅ Can chat with users
- ✅ Can read/write its own memory files
- ❌ Cannot modify project data
- ❌ Cannot access data read/write functions
- ❌ Cannot trigger server-side data operations
- ❌ Cannot call any controller outside `ai*` controllers

## Security (aiSecurity.js)

### Input Sanitization

20 injection patterns are detected and blocked:
- System prompt override attempts ("ignore previous instructions")
- Role injection ("you are now", "act as")
- Data extraction attempts ("show me all users")
- Path traversal
- Jailbreak patterns

Returns `{ clean, injectionDetected, flags[] }`.

### Output Filtering

8 leak filter patterns prevent DoBo from revealing:
- API keys or secrets
- File system paths
- Database queries
- Server internals

### Abuse Detection

Tracks per-user abuse metrics:
- Injection attempts per hour
- Consecutive injection count
- Escalating warnings → temporary bans

## Rate Limiting (aiRateLimiter.js)

Per-user sliding window rate limiter:
- Configurable requests per window
- Applied as Express middleware on all AI routes
- Separate rate limiter for edit requests (5/hour)
- File upload daily limit (5 files/day)

## Cost Tracking (aiCostTracker.js)

Tracks API usage costs:
- Daily cost caps (prevents runaway spending)
- Per-request token counting (input + output)
- Cost recording per API call
- Automatic cap enforcement

## Memory System (aiMemory.js)

DoBo has per-user, per-project file-based memory stored at:

```
storage/<Project>/dobo/<userId>/Chat-Memory/
```

Memory types:
- **Recent context** — what the user was doing recently
- **Preferences** — user preferences and settings
- **Context snapshots** — periodic context saves from frontend
- **Notes** — DoBo's own notes about the user

Memory can be:
- Read: `GET /api/ai/memory`
- Checked: `GET /api/ai/memory/status`
- Cleared: `DELETE /api/ai/memory`
- Regular users can only access their own memory; superadmins can access any user's

## Context Awareness

DoBo receives context from the frontend via `ai-context.js`:
- Current page (e.g., "einblasen", "dashboard")
- Current module and step
- Project name
- User role and permissions
- Idle time (for proactive suggestions)

This context is validated against allowlists of known pages and modules in `aiController.js`.

## Proactive Suggestions

When a user has been idle, the frontend can request a proactive suggestion via `POST /api/ai/proactive`. DoBo generates a context-aware tip based on:
- Current page/module
- User's role and permissions
- App knowledge base

## Edit Requests (aiMailer.js)

When a user asks DoBo to edit something (which DoBo cannot do directly), DoBo can forward the request to the admin:

`POST /api/ai/edit-request` → sends email + logs to file

Rate limited to 5 requests per hour per user. Superadmins can acknowledge pending requests via `POST /api/ai/edit-requests/acknowledge`.

## File Uploads

Users can upload files for DoBo analysis:
- `POST /api/ai/upload?project=X`
- Max 10 MB per file
- Allowed extensions: `.pdf, .xlsx, .xls, .csv, .txt, .jpg, .jpeg, .png`
- Daily limit: 5 files per user
- Stored at: `storage/<Project>/ai-uploads/<userId>/`
