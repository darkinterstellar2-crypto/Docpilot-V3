# BUGS.md — Observed Issues (do not fix here, log only)

---

## index.html — Issues found during redesign (2026-05-12)

- **Orphaned closing tags in original HTML:** The original `index.html` had two stray `</div></div>` closing tags after the `<main>` block with no corresponding opening tags. This was malformed HTML (likely leftover from a partial edit). Cleaned up in redesign.
- **`adminNavBtn` was both a `<button>` (header) and needed to be a sidebar `<a>` link:** Original used a button in the header for admin; redesign moves it to a proper sidebar nav link. The `id="adminNavBtn"` is preserved so JS visibility toggling continues to work.
- **`superLogNavBtn`:** No equivalent element existed in original index.html for the Super Logs page. Added `id="superLogNavBtn"` with `style="display:none"` so JS can reveal it for superadmins (same pattern as `adminNavBtn`).
- **Mobile logout button:** Original had no mobile nav; added a mobile logout button wired to the desktop `logoutBtn` click handler via a small inline script to ensure `logout.js` keeps working.

---

## login.html — Issues found during redesign (2026-05-12)

### BUG-001: No error message element in original markup
- **File:** `login.html` (pre-redesign)
- **Description:** The `auth.js` script likely sets error feedback by ID (e.g., `#loginError`), but the original HTML contained no such element. Any JS that calls `document.getElementById('loginError')` would silently fail or throw a null-reference error, meaning login errors would never be shown to the user.
- **Severity:** High — users get no feedback on failed login attempts.

### BUG-002: No `autocomplete` attributes on inputs
- **File:** `login.html` (pre-redesign)
- **Description:** The `#loginId` and `#loginPass` inputs lack `autocomplete="username"` and `autocomplete="current-password"` attributes. This prevents browser/password-manager autofill and may trigger browser security warnings.
- **Severity:** Medium — UX degradation especially on mobile.

### BUG-003: `animate-fade-in` class with no definition
- **File:** `login.html` (pre-redesign)
- **Description:** The auth card div uses `class="... animate-fade-in ..."` but this utility class is not defined in Tailwind's default config, in the inline `<style>` block, or in the referenced `styles.css` (cannot confirm without reading that file). If undefined, the class has no effect — the animation simply doesn't play.
- **Severity:** Low — visual only, no functional impact.

### BUG-004: Tailwind custom `gray` palette conflicts with Tailwind defaults
- **File:** `login.html` (pre-redesign)
- **Description:** The inline Tailwind config only extends a partial `gray` scale (`50, 100, 200, 300, 800, 900`) while the design references other shades like `gray-400`, `gray-500`, `gray-700`. These missing shades fall back to Tailwind's built-in palette values, which may differ from intended design values — leading to inconsistent greys.
- **Severity:** Low — subtle visual inconsistency.

### BUG-005: No `<link>` for Material Symbols / icon font
- **File:** `login.html` (pre-redesign)
- **Description:** The original file does not load Material Symbols Outlined from Google Fonts. If any part of `auth.js` or future UI extensions attempt to use material icon classes, they will render as raw text strings instead of icons.
- **Severity:** Low for login page itself (no icons used), but indicative of missing global asset setup.

## register.html — Redesign Review (2026-05-12)

### Observations / Potential Issues

1. **OTP single input vs. design reference**: The design calls for 6 individual digit boxes, but `auth.js` reads from a single `#otpCode` element. The redesign implements 6 visual boxes that sync their values into the hidden `#otpCode` input via inline JS. This is a workaround — ideally `auth.js` should support individual OTP box inputs natively.

2. **`formTitle` ID repurposed**: `auth.js` sets `document.getElementById('formTitle').innerText = "Verify Email"` when switching to the OTP step. In the redesign, `formTitle` is the subtitle paragraph under the heading, so the text swap still works but the heading ("Create Account") stays static. Consider updating auth.js to also update the main heading, or expose a second ID for the step heading.

3. **`regEmail` not in OTP form**: The original had no `name` attribute on any register input — this is fine since auth.js reads by ID. Just noted for completeness.

---
## aufmass.html Redesign Notes (2026-05-12)

- **Sidebar admin/superlog links**: `#sidebarAdminLink` and `#sidebarSuperLogLink` are hidden by default with `class="hidden"`. Auth/role JS should toggle visibility — but currently no JS in aufmass.html does this automatically (previously these were not present at all in the old design). If `header-avatar.js` or another script handles sidebar role gating, ensure it targets these IDs.
- **Mobile save button**: Mobile bottom nav "Save" button proxies to the floating `#saveBtn` via `onclick`. This only works when the edit panel is present in DOM (it always is, just hidden), so functionality is preserved.
- **`#headerAvatarBtn`**: Old design had `onclick="window.location.href='profile.html'"` inline. New design keeps same behavior but adds `id="headerAvatarBtn"` so `header-avatar.js` can update it with a real avatar if needed.

---

## files.html Redesign Notes (2026-05-12)

### Visual-only limitations (require future JS work)

**~~BUG-FM-01: Left folder tree panel is not functional~~** ✅ FIXED (2026-06-10)
- ~~The 260px left panel in the two-panel desktop layout is a static placeholder.~~
- ~~It shows a "Navigate via breadcrumb" hint but does not render a live folder tree.~~
- **Fixed:** JS now calls `/api/files/tree?project=...` on load, renders collapsible folder tree in the sidebar panel, wires folder clicks to `navigateTo()`, and highlights the current folder.

**BUG-FM-02: Mobile folder drawer shows current path only, not full tree**
- The mobile "Folders" drawer (#folderDrawer) shows the current path text but not a full navigable tree.
- **Fix needed:** Same tree rendering as FM-01, rendered inside `#folderDrawer`.

**BUG-FM-03: Superadmin sidebar links (Admin, Super Logs) shown via localStorage only**
- Sidebar admin-only links are shown based on `localStorage.getItem('userRole') === 'superadmin'` in a tiny inline script.
- This bypasses the proper permission check the main IIFE performs.
- **Fix needed:** The main IIFE should expose `isAdmin`/`isSuperadmin` globally, or the sidebar items should be shown after permission resolution.

**BUG-FM-04: Mobile bottom "Upload" button proxies through #newBtn**
- The mobile bottom nav Upload button calls `document.getElementById('newBtn')?.click()`.
- This only works if admin. For non-admin users the button is hidden but the logic is slightly indirect.
- Low severity — works correctly, just slightly indirect.

## profile.html — UI Redesign Notes (2026-05-12)

- **No bugs introduced.** All element IDs, form handlers, API calls, and script tags preserved exactly.
- **Observation:** `displayRole` badge relies on JS to inject Tailwind classes at runtime (`bg-purple-100 text-purple-700`). Since Tailwind CDN is used (JIT in browser), these dynamic classes should render fine — no purge risk.
- **Observation:** `inputCreatedAt` field is always disabled (read-only). No edit toggle is wired for it — consistent with original behavior.

---

## apl.html — Issues found during redesign (2026-05-12)

1. **Sidebar superadmin visibility** — Admin and Super Logs nav links are hidden by default and shown via inline JS using `localStorage.getItem('userRole')`. If `header-avatar.js` or `logout.js` also manipulates these, there may be a conflict. No existing sidebar infrastructure was present in original apl.html. New sidebar adds its own inline check consistent with other pages.

2. **logout.js conflict** — The existing `logout.js` script may wire its own logout handler. The sidebar and mobile-bottom-nav also wire logout buttons inline. If `logout.js` conflicts, the inline handlers should be removed and delegated fully to `logout.js`.

3. **Mobile bottom nav Back button** — The mobile back button tries to call `backBtn.onclick` which is set by `apl.js` after DOMContentLoaded. If the mobile back is tapped before apl.js fires, it falls back to `window.history.back()`. This is safe but could navigate incorrectly in edge cases.

4. **No geocam overlay container** — Original apl.html had no explicit geocam or appointment modal DOM containers outside `#moduleContent`; these are created dynamically by `geocam.js` and `modal.js` appended to `<body>`. This is unchanged and should work correctly.

## einblasen.html redesign — 2026-05-12

### Observations (not blocking bugs)
- `addr-row` status left-border uses CSS `data-status` attribute selectors (`.addr-row[data-status="done"]::before`). The existing JS (`renderAddressesWithTermin`) renders `.addr-row` divs without adding `data-status` attributes — the colored left border will fall back to the neutral grey. **Fix:** JS would need to add `data-status="${status.toLowerCase()}"` on each `.addr-row` element, or the border color can be set via inline style. This is a JS-side enhancement, not a CSS/HTML bug.
- Original `einblasen.html` had a top `glass-header` instead of sidebar layout. The redesign now matches `apl.html` sidebar pattern consistently.
- No functional JS IDs or script tags were changed.

---
## planner.html redesign — 2026-05-12

### Observations / Minor Issues

1. **`logout.js` binding**: The sidebar `#logoutBtn` and mobile `#mobileLogoutBtn` IDs are new; if `logout.js` binds to a different selector (e.g. a class or a specific older ID), logout may not work without a one-line update to that script. No logic was changed in this file — just flagging for verification.

2. **`header-avatar.js` target**: The old HTML had no explicit avatar container in the header. The redesign adds `#sidebarAvatar` for display. If `header-avatar.js` targets a specific element ID for avatar injection it may need that ID updated — no JS was changed here.

3. **FAB "New Appointment"**: The FAB button on mobile currently calls `void(0)`. Planner.js does not expose a "new appointment" action in the current version — if one is added later, wire FAB's `onclick` to that handler.

4. **Superadmin sidebar items**: Admin/SuperLog links are hidden via CSS and revealed by an inline `<script>` that reads `localStorage.userRole`. This runs before `force-logout.js` so order is fine, but if role is set asynchronously the links may briefly flicker. Low risk.


---
## knotenpunkt-vorbereitung.html — Redesign Notes (2026-05-12)

### Observations (not bugs per se, but worth noting):
- `logout.js` is loaded as a `<script>` tag AND the sidebar has its own logout handler. If `logout.js` also binds to an element by ID, the sidebar logout button ID `sidebarLogoutBtn` was chosen to avoid conflicts. If `logout.js` expects a specific element ID like `logoutBtn`, confirm no collision.
- `header-avatar.js` likely expects to inject into the topbar. The topbar avatar button exists as a static element; if the script tries to replace it or inject next to it, ensure it can find its anchor (no ID change was made to the topbar-right area — the avatar button has no ID, which is consistent with the original).
- The `btn-secondary` class used by JS in `renderNVTUploadForm` (for `nvtBackBtn`) is now defined in CSS — was missing from the original stylesheet (JS used it but it relied on an external or inline style). ✅ Now defined.

---

## otdr.html Redesign — 2026-05-12

### Observations:
- `otdr.js` references CSS classes (`mod-badge-waiting`, `mod-badge-done`, `mod-badge-incomplete`, `mod-badge-pending`, `glass-card`, `addr-list`, `addr-row`, `drop-zone`, `dz-over`, `count-display`, `count-ok`, `count-warn`, `count-neutral`, `warn-banner`, `sel-file-list`, `sel-file-item`, `remove-sel`, `mode-btn`, `active-replace`, `active-add`, `mode-btn-group`, `otdr-upload-btn`, `upload-status-msg`, `upload-ok`, `upload-err`, `upload-warn`, `file-list-scroll`, `file-list-item`, `file-ext`, `file-ext-pdf`, `file-ext-sor`, `file-ext-other`, `section-h4`, `detail-row`, `detail-lbl`, `detail-val`, `otdr-form-wrap`, `choice-card`, `choice-label`, `choice-desc`, `choice-icon`, `btn-secondary`, `btn-remove-termin`) — all are preserved in the redesigned CSS.
- The `Waiting` badge now has a visible blue glow ring (box-shadow) to make it clearly distinguishable on mobile as the "gate open" state.
- `mobileBackBtn` wires to `#backBtn.onclick` which is set by `otdr.js` — correct delegation pattern (same as apl.html).


## new-project.html Redesign Notes (2026-05-12)
- `logout.js` handles the sidebar logout button (`#sidebarLogoutBtn`) — verify it targets that ID or uses a class selector. Original page had no sidebar, so logout handler may need to support the new sidebar button ID.
- `header-avatar.js` previously targeted the profile icon in the top header. With the sidebar layout, the avatar injection point may need updating or can be ignored (profile is now a sidebar nav link).
- Schema builder's `renderSchemaBuilder()` uses hardcoded dark `bg-gray-900` for group headers — these will render correctly but may look slightly off-brand (navy preferred). Purely cosmetic; JS not changed.

---
## superlog.html — Redesign Notes (2026-05-12)
- **No functional bugs introduced** — all JS logic, element IDs, API calls, and script tags preserved verbatim.
- **Observation:** `emptyState` was originally `display: block` in old code but the new design uses `display: flex` for centering; JS `clearDisplay()` was updated to use `flex` accordingly — purely visual, no logic change.
- **Observation:** `togglePause()` button icon swap now uses Material Symbols (`play_arrow` / `pause`) instead of Unicode emoji — cosmetic only.

## admin.html Redesign Notes (2026-05-12)

### Observed during redesign
- The `generatorSettingsSection` div uses `style.display` toggling by JS to show/hide. A MutationObserver was added (visual-only) to hide/show the fallback placeholder in the Generator tab accordingly.
- The original page duplicated all JS functions in the second big `<script>` block — these were preserved verbatim.
- No `aclUserRoleBanner` was shown before refactor (CSS `hidden` class was correct but the banner content logic references `flex items-center` — this is fine since JS sets className dynamically).

---

## files.html — Session Fixes (2026-06-10)

### Fixed

**BUG-FM-01** (see above) — Folder tree sidebar now functional. ✅

**Sidebar structure mismatch (files.html)** — files.html previously used `<aside id="desktopSidebar">` instead of `<nav class="sidebar-nav">` matching all other pages. This caused the DoBo bunny injection and topbar-glass pattern to break. Fully rebuilt to match the shared sidebar/topbar pattern.  
- Fixed duplicate `class=""` attribute on the sidebar element  
- Added `sidebar-width` Tailwind spacing config  
- Removed inline `margin-left` hacks  
- Header rebuilt to `topbar-glass` pattern for proper DoBo injection  

**`+ New` button color** — Was amber (`bg-amber-400`), visually conflicting with "New Project" button elsewhere. Restyled to white/navy contextual style.  
- Severity was: Medium (user confusion)

### Known Issues (as of 2026-06-10)

**BUG-FM-02: Mobile folder drawer still shows current path only, not full tree**
- Not yet implemented.
- **Fix needed:** Render same tree inside `#folderDrawer` (mobile).

**BUG-FM-03: Superadmin sidebar links shown via localStorage only**
- Still uses `localStorage.getItem('userRole') === 'superadmin'` inline check.
- **Fix needed:** Resolve after proper ACL IIFE.

**BUG-FM-04: Mobile bottom "Upload" button proxies through #newBtn**
- Low severity, works correctly, slightly indirect. Still unresolved.

**Share link never-expires edge case**
- `expiresIn: 0` (Never expires / ♾️) skips auto-cleanup — correct by design.
- No server-side validation confirms 0 is truly intentional vs. a missing value. Consider explicit sentinel.

**Drag-out to desktop (DownloadURL API)**
- Works in Chromium-based browsers only.
- Firefox/Safari: silently no-ops (no error shown to user).
- **Fix needed:** Show browser-incompatibility notice when drag-out is attempted in non-Chromium.
