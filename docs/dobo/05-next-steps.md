# DocPilot Next Steps & Development Roadmap — DoBo Reference

> DoBo: When users ask "what's coming?" or "what are you working on?", this is your reference.

## Active Development (June 2026)

### DoBo AI Improvements (In Progress)
- [x] Two-mode toggle: ⚡ Light (Gemini 2.5 Pro) / 🧠 Heavy (Claude Sonnet 4.6)
- [x] Per-user memory (persistent across sessions)
- [x] Rate limiting (20/min, 100/hr per user)
- [x] Forward-to-admin requests
- [x] File attachment support
- [ ] Documentation folder context (this folder — in progress)
- [ ] Proactive status alerts (e.g., "OTDR now unlocked for Hauptstr. 12")
- [ ] Better photo analysis (analyze APL/OTDR photos for errors)

### UI/Design
- [x] V3 redesign with dark navy sidebar + Material Design 3
- [x] Foldable/collapsible sidebar
- [x] Mobile bottom navigation
- [ ] Dashboard stats cards (project completion %)
- [ ] Dark mode support

### Features
- [ ] GeoCam improvements (better GPS accuracy on mobile)
- [ ] Batch status updates (mark multiple addresses Done at once)
- [ ] Progress export to PDF (full project report)
- [ ] Team workload view (who is working on what)

---

## Architecture / Tech Debt

### Known Issues
- Production pages (glassmorphism) and V3 pages are separate codebases — need to merge
- No automated tests yet
- Mobile sidebar sometimes shows on desktop (fix in progress)

### Planned Improvements
- [ ] Merge V3 design into production
- [ ] Add Jest tests for controllers
- [ ] Add proper logging for DoBo API costs
- [ ] Add PostgreSQL for V4 (multi-tenant SaaS future)

---

## V4 Vision (Future)

The long-term plan is to evolve DocPilot into a SaaS platform:
- **Multi-tenant:** Multiple companies, not just Geggos
- **PostgreSQL:** Real database instead of JSON files
- **More AI:** Predictive completion dates, automated quality checks
- **Mobile app:** React Native or PWA
- **Billing:** Monthly subscription per team

---

## How DoBo Should Handle "What's Next" Questions

When a user asks what's planned or what's coming:
1. Mention the DoBo improvements (most relevant)
2. Mention any UI improvements
3. Be honest that specific timelines aren't set
4. Invite them to share feature requests (you can forward to admin)

Example response:
> "Great question! We're working on several improvements. For me (DoBo), we're adding smarter context awareness and proactive alerts. For the app overall, there are plans for batch operations and better reporting. Is there something specific you'd like to see? I can forward your request to the admin team! 🚀"
