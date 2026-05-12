# Changelog: 2026-04-14 — GeoCam Integration, Settings Panel & Download Fix

**Session:** Afternoon/Evening
**Commits:** `8fd2ebb`, `9ecbd21`, `836e9eb`, `8ff907d`, `57758c2`

---

## GeoCam Integration (`8fd2ebb`)

Initial integration of the GeoCam feature into DocPilot.

- **Fullscreen camera overlay** — camera opens as a fullscreen modal overlay on mobile/desktop, keeping the user in context
- **GPS + address stamp** — captures device GPS coordinates and performs reverse geocoding to embed a human-readable address on the photo
- **Capture flow** — photo is taken via `getUserMedia`, shown in a preview for approval before being accepted
- **Approve / Retake** — user can approve the captured image or retake; cancelling discards the capture without side effects
- **`_U` suffix for uploads** — photos captured via GeoCam are uploaded with a `_U` suffix in the filename to distinguish camera captures from regular file uploads

---

## GeoCam QA Pass (`9ecbd21`)

Quality assurance fixes following the initial GeoCam integration.

- **Cancel on preview** — fixed cancel button behaviour on the preview step; now properly stops the camera stream and closes the overlay
- **Escape key** — pressing `Escape` while the camera overlay is open correctly dismisses it and stops the stream
- **Hash fallback** — if the GPS/geocode lookup fails, a hash of the coordinates is used as a fallback identifier to avoid empty stamps
- **Geocode rate limiter** — added a client-side rate limiter for reverse geocoding requests to prevent hitting API limits on rapid captures
- **Blob URL leak fix** — blob URLs created for camera preview images are now explicitly revoked (`URL.revokeObjectURL`) after use to prevent memory leaks

---

## Download Bug Fix (`836e9eb`)

Fixed file downloads failing for authenticated users.

- **Root cause:** `<a href>` direct download links do not carry the JWT auth token, causing the server to reject the request with 401
- **Fix:** All file download triggers switched from `<a href>` anchor navigation to `fetch` + blob pattern — the fetch call goes through `api.js` which injects the JWT via its request interceptor, the response blob is then turned into a temporary object URL and triggered via a programmatic `<a>` click
- **Scope:** Applies to all file types across DocPilot (PDFs, images, OTDR files, etc.)

---

## GeoCam Full Settings Panel (`8ff907d`)

Added a comprehensive settings panel for GeoCam configuration.

Six configuration sections, all persisted to `localStorage`:

| Section | Controls |
|---|---|
| **Format** | Output format (JPEG/PNG), image quality slider, resolution preset |
| **Overlay** | Toggle timestamp, GPS coordinates, address; position (corner selector) |
| **Fields** | Which metadata fields appear on the stamp (project, user, date, etc.) |
| **Custom Text** | Free-text line added to the stamp (e.g. company name, job ref) |
| **Logo / Watermark** | Upload a logo image; set size, position, opacity |
| **Security** | Toggle tamper-evident hash embedding in EXIF/metadata |

- **localStorage persistence** — all settings survive page reloads and sessions without server round-trips
- **Dark theme panel** — settings panel uses the app's dark theme with consistent styling

---

## QA Pass (`57758c2`)

Final QA pass cleaning up regressions from the settings panel work.

- **Button CSS reset** — settings panel buttons were inheriting global button styles causing visual inconsistencies; added scoped CSS reset for panel buttons
- **File viewer blob URL leak fix** — the file viewer (PDF/image preview modal) was not revoking blob URLs on close; fixed to call `URL.revokeObjectURL` when the viewer modal is dismissed
