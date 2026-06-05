# DoBo — Capabilities, Limitations & Next Steps

## What is DoBo?

DoBo is the AI assistant built into DocPilot. The name "DoBo" is a DocPilot-specific brand. DoBo helps users navigate the app, understand their project data, and get unstuck.

---

## Current Capabilities (June 2026)

### ✅ What DoBo CAN Do

1. **Answer questions about DocPilot** — How modules work, what statuses mean, workflow order
2. **Read project context** — See current page, module, selected address, project name
3. **Explain current data** — When project summary is provided, explain what it means
4. **Guide users** — Step-by-step help for any task in the app
5. **Remember users** — Per-user memory file stores preferences, past conversations, notes
6. **Forward requests to admin** — When user wants something changed that requires admin
7. **Language switching** — Responds in German or English based on user's language
8. **Two AI modes:**
   - ⚡ **Light** = Gemini 2.5 Pro (fast, good for most questions)
   - 🧠 **Heavy** = Claude Sonnet 4.6 via Anthropic (powerful, for complex analysis)
9. **File attachment** — User can attach files for DoBo to analyze (images, PDFs)
10. **Daily cost cap** — Auto-limits per-user and global API spending

### ❌ What DoBo CANNOT Do

1. **Modify project data** — DoBo is STRICTLY read-only. No writes.
2. **Delete anything** — Not files, not addresses, not projects
3. **Access other users' data** — Each user only sees their own context
4. **Reveal source code or API secrets** — Security rule, cannot be overridden
5. **Access the internet** — No web search, only app knowledge

---

## Architecture of DoBo

### Backend (server-side)
```
routes/aiRoutes.js          — API endpoints (/api/ai/*)
controllers/aiController.js — Main orchestration, system prompt builder
controllers/aiProvider.js   — Gemini + Anthropic API wrappers
controllers/aiKnowledge.js  — APP_KNOWLEDGE static text + module docs
controllers/aiMemory.js     — Per-user persistent memory (markdown files)
controllers/aiSecurity.js   — Injection detection, abuse checking, output filtering
controllers/aiCostTracker.js — Daily cost tracking per user
controllers/aiRateLimiter.js — Per-user + global rate limits (20/min, 100/hr)
controllers/aiDataProvider.js — Server-side project data loading for context
controllers/aiMailer.js      — Forward-to-admin notification emails
```

### Frontend (client-side)
```
src/js/ai-chat.js       — Main chat widget (DoBo panel, bubbles, model toggle)
src/js/ai-widget.js     — DoBo launcher button in header
src/js/ai-context.js    — Context gathering (page, project, module, address)
src/js/ai-thoughts.js   — Proactive thinking (idle messages)
src/js/ai-face.js       — DoBo avatar/face component
src/js/dobo-loader.js   — Loads all DoBo scripts on pages that need it
src/css/ai-widget.css   — All DoBo styles
```

### API Endpoints
```
POST /api/ai/chat              — Main chat (auth required, rate limited)
POST /api/ai/proactive         — Idle proactive message
GET  /api/ai/memory            — Read user's DoBo memory
DELETE /api/ai/memory          — Clear user's DoBo memory
POST /api/ai/context           — Save context snapshot
POST /api/ai/upload            — File attachment (10MB limit, 5/day)
POST /api/ai/edit-request      — Forward request to admin
```

---

## DoBo Documentation System (THIS FOLDER)

DoBo's knowledge comes from:
1. **Static APP_KNOWLEDGE** in `aiKnowledge.js` — always included
2. **Module-specific docs** — loaded based on current page/module
3. **Per-user memory** — from `aiMemory.js` (what DoBo remembers about you)
4. **Live project data** — injected by `aiDataProvider.js` for current project
5. **This docs/dobo/ folder** — loaded at startup, merged into APP_KNOWLEDGE

The `docs/dobo/` folder contains:
- `00-overview.md` — App overview
- `01-modules.md` — All modules explained
- `02-dobo-capabilities.md` — This file
- `03-data-model.md` — Data schemas
- `04-workflow.md` — User workflows
- `05-api-routes.md` — API reference
- `06-next-steps.md` — Planned features

---

## Next Steps for DoBo (Planned)

### Short Term
- [ ] **Documentation search** — DoBo can search docs/ folder on demand
- [ ] **Proactive alerts** — DoBo notifies when OTDR unlocks (APL + Splicing done)
- [ ] **Better context injection** — Auto-load relevant module doc based on current page
- [ ] **Session continuity** — DoBo summarizes and restores context when user returns

### Medium Term
- [ ] **Voice interface** — DoBo speaks (TTS) on mobile
- [ ] **Photo analysis** — DoBo analyzes uploaded site photos for issues
- [ ] **Report generation** — DoBo writes progress reports from project data
- [ ] **Smart suggestions** — DoBo notices patterns (e.g., cluster X always has errors) and flags them

### Long Term
- [ ] **Multi-project awareness** — DoBo understands all projects, not just current one
- [ ] **Team coordination** — DoBo helps assign work to technicians based on availability
- [ ] **Predictive status** — DoBo predicts which addresses will be done by end of week
