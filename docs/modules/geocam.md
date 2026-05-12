# GeoCam Module

**File:** `src/js/geocam.js`  
**ACL Key:** _(none — included on authenticated pages, no server-side ACL)_  
**Purpose:** In-browser camera overlay that stamps captured photos with GPS coordinates, address, date/time, and optional custom text. Used by APL for required image capture.

---

## Overview

GeoCam is a standalone JavaScript module (`window.GeoCam`) with no external dependencies. It opens a fullscreen overlay with:
- Live camera viewfinder
- Settings button (⚙)
- Shutter button
- Preview screen (Use Photo / Retake)

On capture, it resolves GPS coordinates via the Geolocation API, reverse-geocodes via the Nominatim proxy (`/api/geocode`), and composites an overlay onto the photo canvas. The resolved `{ blob, metadata }` is returned to the caller.

---

## API

```js
const result = await window.GeoCam.capture({
    userText: 'Metrierung Image'   // optional custom text for the overlay
});

// result is null if user cancelled
// result = {
//   blob: Blob,               // JPEG image blob
//   metadata: {
//     timestamp: Date,
//     lat: number,
//     lng: number,
//     altitude: number | null,
//     address: { road, suburb, city, postcode, country },
//     userText: string
//   }
// }
```

---

## Capture Flow

```
GeoCam.capture() called
    ↓
Fullscreen overlay appended to document.body (z-index: 99999)
    ↓
Camera stream started (getUserMedia, rear camera preferred: facingMode='environment')
    ↓
Live video displayed in viewfinder
Overlay fields updated every second (datetime, GPS if already acquired)
    ↓
Geolocation.getCurrentPosition() called in parallel
    (Position cached for 30 min: geocam-pos-v1 in localStorage)
    ↓
Nominatim reverse-geocode: GET /api/geocode?lat=X&lng=Y
    (Debounced: reuses cached result if same coords within 10s)
    ↓
User presses shutter [●]
    ↓
Canvas = video frame
Overlay composited on top (position, color, font size from settings)
    ↓
Preview screen: full-size preview + [Use Photo] / [Retake]
    ↓
[Use Photo] → resolve { blob, metadata }
[Retake] → back to camera view
[✕] → resolve null (cancelled)
```

---

## Overlay Composition

The overlay is a semitransparent text block drawn on the canvas. Fields are drawn in order (by `order` property in settings), enabled fields only.

### Overlay Fields (6 configurable + 2 always-on)

| ID | Label | Default | Description |
|---|---|---|---|
| `datetime` | Date & Time | enabled | Formatted date + time |
| `address1` | Street | enabled | Road name from Nominatim |
| `address2` | City & Postcode | enabled | City + postcode from Nominatim |
| `address3` | Country | enabled | Country from Nominatim |
| `coordinates` | Coordinates | enabled | `48.000000°N, 10.000000°E` |
| `altitude` | Altitude | enabled | `Alt: 623.4m` or `Alt: N/A` |
| `weather` | Weather | disabled | Planned feature, not yet implemented |
| `usertext` | Custom Text | enabled | Passed in by caller (e.g. `"Metrierung Image"`) |

### Overlay Position Options
- `bottom-left` (default)
- `bottom-right`
- `top-left`
- `top-right`

### Overlay Color
Default: `#FACC15` (yellow). Configurable in settings.

### Font Size
Default: 14px. Configurable 10–24px.

---

## Settings Panel

Accessed via ⚙ button during camera view. Six sections:

### 1. Date & Time Format
- **Date**: `DD.MM.YYYY` | `MM/DD/YYYY` | `YYYY-MM-DD` | `DD/MM/YYYY`
- **Time**: `HH:mm:ss` | `HH:mm` | `hh:mm:ss A`

### 2. Overlay Position
Radio buttons: Bottom Left / Bottom Right / Top Left / Top Right

### 3. Overlay Appearance
- Color picker (`overlayColor`)
- Font size slider (10–24px)

### 4. Overlay Fields
Toggle + reorder (drag-and-drop or up/down buttons) for each field. Fields shown in `order` sequence.

### 5. Custom Text
Free-text input saved as `userText` in settings. Can be overridden per-capture via `capture({ userText: '...' })`.

### 6. Logo
Upload a logo image (stored as data URL in settings). Logo drawn in corner of overlay if set.

Settings persist in `localStorage` under key `geocam-settings-v1`.

---

## Geolocation & Geocoding

### GPS Acquisition
```js
navigator.geolocation.getCurrentPosition(success, error, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 60000
})
```

Position is cached in `localStorage['geocam-pos-v1']` for 30 minutes. On next capture within 30 minutes, the cached position is used immediately while a fresh request runs in the background.

### Nominatim Proxy
```
GET /api/geocode?lat=48.1234&lng=10.5678
```

- Server-side: 60-second cache (4-decimal precision, ~50m), max 500 entries
- Rate limit: 30 requests per minute per IP
- GeoCam client-side: debounced 10-second cache + distance check (< 0.0005°)
- No auth required (mounted before auth middleware)

Response (Nominatim format):
```json
{
  "address": {
    "road": "Hauptstraße",
    "suburb": "Mitte",
    "city": "Laichingen",
    "postcode": "89150",
    "country": "Deutschland"
  }
}
```

Fallback if geocoding fails: shows coordinates only, no address text.

---

## Hash Feature

When `enableHash: true` in settings, a SHA-256 hash of the image data is appended to the overlay. Provides tamper-evidence for the captured image.

---

## Camera Setup

- Requests rear camera: `{ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } }`
- Falls back to any available camera if rear not available
- Camera stream stopped on close (both cancel and photo taken)

---

## APL Integration

In `apl.js`, each of the 4 image zones has a "📷 Take Photo" button that calls:
```js
const result = await window.GeoCam.capture({ userText: IMAGE_TYPES[i].label });
```

If result is non-null:
- Creates a `File` object with synthetic name: `{ImageType}_{YYYYMMDD_HHmmss}.jpg`
- Sets the zone file with source `'camera'` (→ no `_U` suffix in final filename)

If GeoCam is not loaded, falls back to file picker.

---

## localStorage Keys

| Key | Content | TTL |
|---|---|---|
| `geocam-settings-v1` | All settings (JSON) | Persistent |
| `geocam-pos-v1` | Last GPS position + `_ts` timestamp | 30 min |

---

## Key Code Files

- `src/js/geocam.js` — full module (~1342 lines)
- `routes/geocodeRoutes.js` — Nominatim proxy (mounted at `/api/geocode`)

---

## Recent Changes

- No specific changes on 2026-04-13/14; GeoCam was integrated as-is for APL capture
