# Frontend Architecture

DocPilot's frontend is built with **vanilla JavaScript** — no React, Vue, or Angular. Each page is a standalone HTML file that includes the necessary JS scripts.

## Technology

- **HTML:** Standalone pages, no templating engine
- **CSS:** Tailwind CSS loaded from CDN, supplemented by `src/css/styles.css`
- **JavaScript:** Vanilla ES6+ in `src/js/`, loaded via `<script>` tags
- **Icons:** Google Material Symbols (CDN)
- **Font:** Inter (Google Fonts CDN)

## Design System

**Industrial Modern** theme:

| Element | Value |
|---------|-------|
| Sidebar background | Navy `#022448` |
| Content background | `#F8FAFC` |
| Accent color | Amber `#fea619` |
| Font | Inter |
| Border radius | Generally `0.75rem` to `1.25rem` |
| Shadows | Subtle `rgba(0,0,0,0.08)` |

## Page Structure

Every authenticated page follows this template:

```html
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/..." rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/src/css/styles.css">
</head>
<body>
    <!-- Sidebar Navigation -->
    <nav class="sidebar-nav">...</nav>

    <!-- Main Content -->
    <main class="main-content">
        <!-- Header -->
        <header>...</header>
        <!-- Page-specific content -->
    </main>

    <!-- Scripts (order matters) -->
    <script src="/src/js/api.js"></script>           <!-- MUST be first -->
    <script src="/src/js/force-logout.js"></script>
    <script src="/src/js/idle-logout.js"></script>
    <script src="/src/js/sidebar-toggle.js"></script>
    <script src="/src/js/header-avatar.js"></script>
    <script src="/src/js/logout.js"></script>
    <script src="/src/js/i18n.js"></script>
    <script src="/src/js/page-specific.js"></script> <!-- Page logic -->
</body>
</html>
```

## Shared JavaScript Modules

### api.js (Global Fetch Interceptor)

**Must be loaded first** on every page. Intercepts all `fetch()` calls to `/api/` endpoints:
1. Injects `Authorization: Bearer <token>` from localStorage
2. Auto-refreshes token when within 30 minutes of expiry
3. Sets legacy `x-user-email` and `x-user-role` headers

### force-logout.js

Global fetch interceptor for 401 responses. Detects `forceLogout` (admin terminated) or `tokenExpired` flags, clears localStorage, and redirects to login.

### idle-logout.js

Inactivity auto-logout:
- Regular users: 2 hours
- Superadmin: 30 minutes
- Tracks activity via localStorage (shared across tabs)
- Shows warning banner 2 minutes before logout
- Events monitored: click, keypress, scroll, mousemove, touchstart, fetch

### sidebar-toggle.js

Collapsible sidebar navigation:
- State persisted in `localStorage('sidebar-collapsed')`
- Toggles `.sidebar-collapsed` class on sidebar and main content
- IIFE (immediately-invoked function expression) — no globals

### header-avatar.js

Loads and displays the user's avatar in the page header. Falls back to initials if no avatar.

### logout.js

Handles the logout button: calls `POST /api/auth/logout`, clears localStorage, redirects to login.

### modal.js (260 lines)

Reusable modal system:
- Programmatic creation of modals with title, body, and buttons
- Supports confirm/cancel patterns
- Keyboard support (Escape to close)
- Backdrop click to close

### i18n.js (242 lines)

English/German language toggle. See [Internationalization](./i18n.md).

### table.js (1340 lines)

The Aufmass data table renderer. Features:
- Dynamic column groups with merged headers
- View/edit mode toggle
- Cell editing with change tracking
- Row add/delete
- Search/filter across all columns
- Status badge rendering
- Optimistic locking display
- Unsaved changes warning

### module-shared.js (1016 lines)

The `ModuleNavigator` class — used by all module pages. See [Work Modules](./modules.md).

### appointment-shared.js (422 lines)

Shared appointment scheduling logic. Provides UI for:
- Setting date, time, and notes
- Saving appointment data to Aufmass termin columns
- Visual indicators for upcoming/overdue appointments

### geocam.js (1641 lines)

Camera + GPS overlay for field documentation. The largest frontend file. Features:
- Camera access with live GPS overlay
- Photo capture with location watermark
- Reverse geocoding via `/api/geocode`
- Auto-naming with address + timestamp
- Compass heading display
- Multi-photo capture mode

### dashboard.js (407 lines)

Hub/dashboard page:
- Loads projects and permissions
- Renders project cards with status badges
- Permission-based UI (show/hide buttons based on ACL)
- Project status change dropdown
- Reorder buttons
- Delete confirmation
- Navigation to module pages

### new-project.js (290 lines)

New project wizard:
- Project name input
- Schema editor (add/remove/reorder column groups)
- Location/cluster input
- Custom folder structure builder
- Description and custom fields
- Validation and creation

## Authentication Guard

Most pages check authentication on load:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const userRole = localStorage.getItem('userRole');
    if (!userRole) {
        window.location.href = 'login.html';
        return;
    }
    // ... page logic
});
```

There is no client-side routing. Each HTML page is a separate entry point.

## Data Flow

1. Page loads → checks localStorage for auth
2. `api.js` intercepts all fetch calls → injects JWT
3. Page JS fetches data from API → renders UI
4. User actions trigger API calls → UI updates
5. `force-logout.js` watches for 401s → redirects if session invalid
6. `idle-logout.js` watches for inactivity → auto-logout

## CSS Architecture

### src/css/styles.css

Contains:
- Sidebar styles (`.sidebar-nav`, `.sidebar-collapsed`)
- Card and badge styles
- Form input styles
- Animation keyframes
- Print styles
- Responsive breakpoints

### src/css/ai-widget.css

DoBo AI widget styles:
- Floating chat button
- Chat window positioning
- Message bubbles
- Animated face
- Thought bubbles
