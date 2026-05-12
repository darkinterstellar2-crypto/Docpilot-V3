# Idle Logout

**File:** `src/js/idle-logout.js`  
**Included on:** All **15** authenticated pages (after `api.js`): admin, apl, aufmass, dashboard, druckprufung, einblasen, files, index, kalibrieren, knotenpunkt-vorbereitung, new-project, otdr, planner, profile, superlog  
**Purpose:** Automatically log out users after a period of inactivity, with a countdown warning before logout.

---

## Overview

`idle-logout.js` is an IIFE (Immediately Invoked Function Expression) that runs silently on every authenticated page. It monitors user activity via DOM events and `window.fetch` interception. When a user is inactive for too long, it shows a dismissable countdown banner and then performs logout.

No server interaction — purely client-side timer logic using `localStorage` for cross-tab coordination.

---

## Inactivity Thresholds

| Role | Idle Timeout | Warning |
|---|---|---|
| Regular users | **2 hours** (120 min) | 2 minutes before logout |
| superadmin | **30 minutes** | 2 minutes before logout |

Role is read from `localStorage.getItem('userRole')` at script load.

---

## Activity Detection

The script listens on `document` (passive, capture phase):

```js
const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart', 'touchmove'];
```

**Throttled**: only updates `localStorage` once per 10 seconds for high-frequency events (mousemove, scroll) to avoid localStorage thrash.

**Fetch interception**: `window.fetch` is monkeypatched to reset the activity timer on every API call.

---

## Cross-Tab Sync

Activity timestamp is stored in `localStorage`:
```
_docpilot_lastActive  →  "1713094800000"  (Unix ms timestamp)
```

All tabs for the same user share this key. When one tab is active, others see the updated timestamp and their warnings are dismissed:

```js
window.addEventListener('storage', (e) => {
    if (e.key === '_docpilot_lastActive' && e.newValue) {
        if (warned) hideWarning();
    }
});
```

Tabs also reset when they become visible again (visibilitychange event).

---

## Check Loop

```
setInterval(checkIdle, 30_000)   // every 30 seconds
```

When warning triggered (≤ 2 minutes remaining):
- Switches to **5-second interval** for smooth countdown
- Calls `showWarning(remainingSeconds)` on every tick

---

## Warning Banner

A fixed-position red gradient banner slides down from the top of the page:

```
⚠️ You will be logged out due to inactivity in 1m 47s  [Stay Logged In]
```

- **[Stay Logged In]** button resets activity (bypasses throttle, calls `touchActivity()` immediately)
- Warning hidden when user becomes active
- Banner removed when warning dismissed

Banner styles are injected via an inline `<style>` element on first show.

---

## Logout Sequence

```js
function doIdleLogout() {
    clearInterval(intervalId);         // stop all timers
    clearInterval(warnIntervalId);
    localStorage.removeItem(LS_KEY);   // clear activity key
    
    if (typeof window.doLogout === 'function') {
        window.doLogout();             // use shared logout (clears tokens, calls API)
    } else {
        // Fallback: clear localStorage manually
        localStorage.removeItem('userRole');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userName');
        localStorage.removeItem('authToken');
        alert('You have been logged out due to inactivity.');
        window.location.href = 'login.html';
    }
}
```

Guard `loggingOut` flag prevents double-fire from dual check intervals.

---

## Configuration Constants

```js
const IDLE_MS_USER       = 2 * 60 * 60 * 1000;   // 7,200,000 ms
const IDLE_MS_SUPERADMIN = 30 * 60 * 1000;        // 1,800,000 ms
const CHECK_INTERVAL_MS  = 30 * 1000;              // 30 seconds
const WARN_BEFORE_MS     = 2 * 60 * 1000;          // 2 minutes
const LS_KEY             = '_docpilot_lastActive';
```

---

## Early Return Conditions

The script exits immediately (does nothing) if:
- `localStorage.getItem('userEmail')` is null/empty
- `localStorage.getItem('userRole')` is null/empty

This prevents the script from running on login or register pages.

---

## Dependency on `doLogout`

If `window.doLogout` is defined (typically by `api.js` or a shared auth module), it's called for a clean logout (clearing session, calling the logout API). Otherwise, the manual fallback clears tokens and redirects.

---

## Key Code File

- `src/js/idle-logout.js` — full implementation (~140 lines)
