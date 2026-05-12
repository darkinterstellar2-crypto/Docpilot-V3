# APL (Abschlusspunkt Linientechnik) Module

## Overview

### What it does

**For the field worker:** APL is the main fiber connection documentation step. After the cable is blown in, a technician visits each endpoint (APL = a connection box installed at a building) and documents the work with 4 mandatory photos: Metrierung (measuring the cable length), APL Box (the box itself), Splices (the fiber splice tray inside), and Inside APL (interior view). Photos can be taken directly in the app with a GPS-stamped camera overlay, or uploaded from the device. The worker also records the splice count, date/time, and can schedule appointments. Error reporting is built in.

**For the developer:** This is the most complex module in DocPilot. It completely bypasses `ModuleNavigator`'s standard upload form (`customUploadForm: true`) and implements its own multi-image upload form. Key unique features: GeoCam integration (fullscreen browser camera with GPS/address overlay), appointment scheduling via `AppointmentHelper`, Eigentümerdaten (owner/customer contact display), splice count confirm/update flow, `_U` suffix on uploaded (non-camera) files, error reporting with `APL:` prefix, and cross-module status trigger (when APL + Knotenpunkt status both become Done, server automatically sets OTDR status to "Waiting").

### Why it exists in the workflow

APL documentation is the core quality assurance proof. The four photos prove:
1. **Metrierung** — the exact cable length was measured and documented
2. **APL Box** — the box is correctly installed at the right location
3. **Splices** — all fiber splices were made inside the box
4. **Inside APL** — the interior is tidy and sealed

GPS-stamped photos prevent backdating fraud and prove the photos were taken at the actual site. The `_U` suffix on uploaded photos (from device rather than live camera) flags them for quality review.

### Domain terms

| Term | Meaning |
|------|---------|
| **APL** | Abschlusspunkt Linientechnik — the fiber connection box installed at a building's facade or cellar entry |
| **Knotenpunkt** | Junction cabinet (NVT) from which the cables to APLs originate |
| **Metrierung** | Measurement of the actual cable length blown in, in meters |
| **Splices** | The physical fiber glass joints made inside the APL box |
| **NVT** | Netzverteilertechnik — the street-level distribution cabinet |
| **GeoCam** | DocPilot's built-in camera module — overlays GPS coordinates, address, datetime on photos |
| **`_U` suffix** | Marks a file as "Uploaded from device" (not geo-stamped by camera) |
| **Eigentümerdaten** | Owner/customer contact data — name, phone, email for the property |
| **Termin** | Appointment — `{date, time, notes}` JSON stored in an aufmass column |

---

## User Journey (Step by Step)

### 1. Dashboard → Module

`dashboard.html?project=PROJECTNAME` → click APL card → `apl.html?project=PROJECTNAME`

Auth guard: `localStorage.getItem('userRole')` + `urlParams.get('project')`.

### 2. Cluster → Knotenpunkt Navigation

Standard `ModuleNavigator` cards. No differences here.

### 3. Address List

Standard ModuleNavigator address list with Done/Pending/Error badges.

Each row additionally shows an **appointment badge** (green dot = upcoming, red dot = overdue) from `terminBadgeHTML()`.

### 4. Choice Screen

Clicking an address renders `renderChoiceScreen(cluster, knotenpunkt, address)`.

**Components:**

#### Address Info Card
- Knotenpunkt / address name
- Cable name + fiber type
- Status badge (Done / Error / Pending)
- If Done: date + time card showing when work was done (from "Timing" group columns)

#### Eigentümerdaten Card (Owner Contact)
- Built by `buildCustomerHTML(address)` using columns from the "eigentümer" group:
  - `findColumnId('eigentümer', 'name')` → owner names (split on " o. ", " und ", ","  — each rendered as 👤 span)
  - `findColumnId('eigentümer', 'phone')` → phones (split on " o. " → clickable `tel:` links 📞)
  - `findColumnId('eigentümer', 'email')` → emails (split on ";", "|", " o. " → clickable `mailto:` links ✉️)
- Only rendered if at least one field has data

#### Error Detail Card (if status = Error)
- Red box showing active `APL:` errors
- Green section showing fixed errors (entries ending in `#`)
- Parsed from `error-reporting` column: `APL:description;` entries

#### Appointment Card (if termin set)
```
AH.terminInfoHTML(termin)
→ green/red dot + "Upcoming/Overdue Appointment"
→ formatted date + time
→ notes (if any)
```

#### Button Grid (`AH.choiceButtonsHTML(isDone, termin)`)
- **Left:** 📅 "Mark Appointment" / ✏️ "Edit Appointment" / disabled (if Done)
- **Right:** 📷 "Upload Work" (becomes "Re-upload / Edit" if files exist)

#### Error Buttons Row
- Red "⚠ Report Error" (always)
- Green "✓ Clear Error" (only if status = Error)

#### Files Section (async, injected if Done or Error)
- Fetches from `GET /api/modules/list-files?path=CLUSTER/APL/KNOTEN`
- Filtered to files matching the current address name (boundary-safe)
- Each file row: icon + name + size + ⬇ download + 🗑 delete
- Last file deleted → status reset to Pending, APL errors stripped

### 5a. Schedule Appointment

Clicking appointment button calls `AH.renderAppointmentForm({...})` with:
```js
{
    el: moduleContent,
    existingTermin: termin,        // null if new, object if editing
    knotenpunkt,
    addrDisplay,
    nav,
    projectName,
    userEmail,
    address,
    terminColId,                   // nav.findColumnId('splicing', 'apl-termin')
    moduleKey: 'apl',
    onDone: () => renderChoiceScreen(cluster, knotenpunkt, address)
}
```

**Conflict detection:** Before saving, `AH.checkConflicts(projectName, 'apl', date, time, address.id)` checks all APL appointments on the same date. Any appointment within ±40 minutes triggers the conflict modal.

**Conflict modal** lists conflicting addresses with their times. "Force Schedule" continues; "Cancel" returns to form.

**Save:** `POST /api/modules/aufmass-update` with `{[terminColId]: JSON.stringify({date, time, notes})}`.

**Remove:** Clears terminColId to `""`.

### 5b. APL Upload Form

Clicking "Upload Work" calls `renderAPLForm(cluster, knotenpunkt, address)`.

**Form layout:**

#### Header Card
- Knotenpunkt / address, cable name, fiber type
- Target path displayed: `CLUSTER/APL/KNOTEN/AddressClean/`
- Current status badge

#### Date/Time Fields
- `#aplDate` — date input (default: today)
- `#aplTime` — time input (default: current time)

#### Splice Count Card
**Case A — splice count exists in aufmass:**
- Shows existing count with "from Aufmass" label
- Two buttons: **✓ Confirm** and **✎ Update**
- "Confirm" → sets `spliceCountFinal` hidden input to existing value
- "Update" → reveals edit section with warning ("Changing will be logged") + new number input
- Edit Confirm → sets `spliceCountFinal` to new value, `spliceWasUpdated` → "true"
- Shows updated display: "72 Updated (was 48)"

**Case B — no splice count in aufmass:**
- Warning: "⚠️ No splice count in Aufmass — enter manually"
- Number input directly

Upload button disabled until `spliceCountFinal` has a valid positive integer.

#### Required Images Grid (4 zones)

4 image zones in a 2×2 grid:
```
IMAGE_TYPES = [
    { id: 'Metrierung', label: 'Metrierung Image', icon: '📏' },
    { id: 'APL_Box',    label: 'APL Box Image',    icon: '📦' },
    { id: 'Splices',    label: 'Splices Image',    icon: '🔗' },
    { id: 'Inside_APL', label: 'Inside APL Image', icon: '🔍' },
]
```

Each zone has:
- Required dot indicator
- Zone icon + label (updates to show filename/source on fill)
- Image preview thumbnail
- **📷 Take Photo** button → GeoCam capture
- **📁 Upload** button → file picker (jpeg/png)
- **✕** clear button (top-right, appears on hover)
- Drag-and-drop support (counts as `'upload'` source)

Zone state variables:
```js
let requiredFiles = [null, null, null, null];
let fileSources   = ['camera', 'camera', 'camera', 'camera'];
// 'camera' = taken with GeoCam (no _U suffix)
// 'upload' = file picker or drag-drop (adds _U suffix to filename)
```

Upload button enabled only when all 4 required files are set AND `spliceCountFinal` is valid.

#### Additional Images Section (optional)
- "Add more images" button → multi-file picker (jpeg/png)
- Files listed with ✕ remove per file
- No limit (but original filenames used, no renaming)

### 5c. GeoCam Capture Flow

When user clicks "📷 Take Photo" on any zone:

1. `window.GeoCam.capture({ userText: 'Metrierung Image' })` is called
2. GeoCam opens a **fullscreen overlay** (z-index 99999, appended to `document.body`)
3. **Camera view:**
   - Live video feed from device camera (rear camera preferred: `facingMode: 'environment'`)
   - GPS coordinates + address being resolved in the background (Nominatim via `/api/geocode`)
   - Real-time data overlay (position configurable: top-left/right, bottom-left/right)
   - **⚙ gear button** → opens settings panel (slides in from right)
   - **📷 shutter button** → captures frame
   - **✕ close button** → resolves promise with `null`
4. **Preview screen** (after shutter):
   - Shows captured frame with full overlay baked in
   - **"Use Photo"** → resolves with `{blob, metadata}`
   - **"Retake"** → returns to camera view
5. Back in apl.js:
   ```js
   const result = await window.GeoCam.capture({ userText: IMAGE_TYPES[i].label });
   if (result) {
       const file = new File([result.blob], `${IMAGE_TYPES[i].id}_${ts}.jpg`, { type: 'image/jpeg' });
       setZoneFile(i, file, 'camera');  // source = 'camera' → NO _U suffix
   }
   ```

If `window.GeoCam` is not loaded (script load failure), falls back to standard file picker.

### GeoCam Settings Panel (6 Sections)

Opened via the ⚙ button in camera view. Slides in as a dark panel from the right edge. Settings persist in `localStorage` under key `"geocam-settings-v1"`.

#### Section 1: Format
- **Date format:** DD.MM.YYYY (default) / MM/DD/YYYY / YYYY-MM-DD / DD/MM/YYYY
- **Time format:** HH:mm:ss (default) / HH:mm / hh:mm:ss A

#### Section 2: Overlay
- **Position chips:** bottom-left (default) / bottom-right / top-left / top-right
- **Color:** hex color input (default: `#FFFFFF`)
- **Font size:** range slider (8–32px, default: 14px)

#### Section 3: Fields
Draggable list of overlay data fields, each with a toggle and ↑/↓ reorder buttons:
- **Date & Time** (default: on, order 0)
- **Street** (on, order 1) — from Nominatim reverse geocode
- **City & Postcode** (on, order 2)
- **Country** (on, order 3)
- **Coordinates** (on, order 4) — `52.123456°N, 9.876543°E`
- **Altitude** (on, order 5) — `Alt: 456.7m`
- **Weather** (off, order 6)
- **Custom Text** (on, order 7)

#### Section 4: Custom Text
- Textarea for multi-line custom text
- Each line is rendered as a separate overlay line
- The `userText` passed to `GeoCam.capture({ userText })` OVERRIDES this setting for that capture (it's injected at runtime, not saved)

#### Section 5: Logo / Watermark
- **Logo upload** button → loads image from file, stores as base64 dataURL in settings
- Logo renders in the overlay corner (opposite to text position) scaled proportionally
- **Remove** button clears the logo

#### Section 6: Security
- **SHA-256 hash toggle** — when enabled, the final JPEG blob is hashed and the hash is included in `metadata.hash` returned by `capture()`. Not shown in the overlay; used for tamper detection downstream.

**Settings persistence:**
```js
// Saved to localStorage on every change
localStorage.setItem('geocam-settings-v1', JSON.stringify({
    dateFormat, timeFormat, overlayPosition, overlayColor, overlayFontSize,
    overlayFields, userText, logoDataUrl, enableHash
}));
```

**Deep-merge on load:** New fields added to `DEFAULT_FIELDS` are always picked up even if `localStorage` has an older version (merge by `id`).

### 5d. File Upload Execution (`handleAPLUpload`)

```js
async function handleAPLUpload(cluster, knotenpunkt, address) {
    const spliceCount = parseInt(spliceCountFinal.value, 10);
    const spliceWasUpdated = spliceWasUpdatedInput.value === 'true';
    const addressClean = cleanAddress(address.end);
    const targetPath = `${cluster}/APL/${knotenpunkt}/${addressClean}`;
    const now = formatDateTime(); // "YYYYMMDD_HHmmss"

    // Upload 4 required images (one at a time, in loop)
    for (let i = 0; i < IMAGE_TYPES.length; i++) {
        const ext = file.name.split('.').pop().toLowerCase();
        const suffix = fileSources[i] === 'upload' ? '_U' : '';
        const customName = `${knotenpunkt}_${addressClean}_${IMAGE_TYPES[i].id}_${now}${suffix}.${ext}`;
        // POST /api/modules/upload with customName
    }

    // Upload extra files (no renaming — original filenames)
    for (const extra of extraFiles) {
        // POST /api/modules/upload (no customName)
    }

    // Build aufmass updates
    const updates = {
        [statusColId]:   'Done',
        [spliceColId]:   String(spliceCount),    // updates aufmass splice count if changed
        [dateColId]:     aplDate,                // Timing group date column
        [timeColId]:     aplTime,                // Timing group time column
        [folderColId]:   `Doku/${targetPath}/`,  // where the images are stored
    };

    // If splice was updated: also log change in notes
    if (spliceWasUpdated) {
        const noteLog = `Splice count updated: ${spliceOriginal} → ${spliceCount}`;
        // appends to notes column
    }

    POST /api/modules/aufmass-update
}
```

**After successful upload:**
- Shows "✓ Upload complete" status
- After 1.6s → re-navigates to knotenpunkt address list (refreshes all status badges)

### 5e. Report Error

Same pattern as Einblasen but with `APL:` prefix:
```js
// Error log entry: "APL:description;"
updates[errorColId] = existingLog + 'APL:' + errorText + ';';
updates[statusColId] = 'Error';
```

### 5f. Clear Error

```js
// Finds last unfixed APL: entry (doesn't end in #), appends #
// Checks if any unfixed remain — if none, status → ""
```

---

## Technical Architecture

### Frontend Files

| File | Role |
|------|------|
| `apl.html` | Page shell |
| `src/js/appointment-shared.js` | `AppointmentHelper` — scheduling forms + conflict detection |
| `src/js/module-shared.js` | `ModuleNavigator` — navigation + column resolution |
| `src/js/geocam.js` | `window.GeoCam` — fullscreen camera with GPS overlay |
| `src/js/apl.js` | All APL-specific logic |

**Load order:**
```html
<script src="src/js/api.js"></script>
<script src="src/js/modal.js?v=..."></script>
<script src="src/js/appointment-shared.js?v=..."></script>
<script src="src/js/module-shared.js?v=..."></script>
<script src="src/js/geocam.js?v=..."></script>
<script src="src/js/apl.js?v=..."></script>
<script src="src/js/logout.js"></script>
<script src="src/js/i18n.js"></script>
<script src="src/js/idle-logout.js?v=..."></script>
```

`geocam.js` must be loaded **before** `apl.js` — it registers `window.GeoCam` on the global scope.

### ModuleNavigator Config (in apl.js)

```js
const nav = new ModuleNavigator({
    project:          projectName,
    moduleKey:        'apl',
    targetFolder:     'APL',
    groupLabel:       'splicing',           // APL uses the 'splicing' group for its status column
    customUploadForm: true,                 // Bypass standard upload form entirely
    onAddressSelected: (cluster, knotenpunkt, address) => {
        renderChoiceScreen(cluster, knotenpunkt, address);
    },
    containers: {
        content:    document.getElementById('moduleContent'),
        breadcrumb: document.getElementById('moduleBreadcrumb'),
    }
});
```

`groupLabel: 'splicing'` is key — APL's status column lives in the **splicing group**, not a dedicated APL group. This is because APL and Knotenpunkt/Splicing share the same schema group.

### Backend Endpoints

#### GET /api/modules/navigation
```
GET /api/modules/navigation?project=SUPPN&module=apl
```
Standard structure. ACL enforced for `apl` module.

#### POST /api/modules/upload (repeated per image)
```
POST /api/modules/upload
Content-Type: multipart/form-data

project    = "SUPPN"
targetPath = "SUPPN/APL/NVt-14/Zeilerweg-11"
customName = "NVt-14_Zeilerweg-11_Metrierung_20260414_143022.jpg"
             OR
             "NVt-14_Zeilerweg-11_APL_Box_20260414_143022_U.jpg"  (uploaded from device)
files[]    = <JPEG>
```

Called once per required image (4 calls) plus once per extra image (N calls).

#### GET /api/modules/list-files
```
GET /api/modules/list-files?project=SUPPN&path=SUPPN/APL/NVt-14
Headers: x-user-email, x-user-role
```

Response: `{ success: true, files: [{ name, size, mtime }] }`

Files are then filtered client-side by address clean name.

#### POST /api/modules/aufmass-update
```json
{
  "project": "SUPPN",
  "rowId": "ROW-0042",
  "updates": {
    "col-3-0": "Done",           // splicing > apl status
    "col-3-1": "72",             // splicing > number of splices
    "col-9-0": "2026-04-14",     // timing > date
    "col-9-1": "14:30",          // timing > time
    "col-3-4": "Doku/SUPPN/APL/NVt-14/Zeilerweg-11/"  // splicing > apl folder path
  },
  "module": "apl",
  "note": "APL upload — Zeilerweg-11"
}
```

#### GET /api/geocode (used by GeoCam internally)
```
GET /api/geocode?lat=48.123456&lng=9.876543
```

**Response:**
```json
{
  "display_name": "Zeilerweg 11, 89150 Laichingen, Germany",
  "address": {
    "road": "Zeilerweg",
    "house_number": "11",
    "postcode": "89150",
    "city": "Laichingen",
    "country": "Germany"
  }
}
```

Proxied through DocPilot backend to Nominatim (avoids CORS). Debounced: won't re-request if within 0.0005° of last query and within 10 seconds.

#### DELETE /api/files
```
DELETE /api/files?project=SUPPN&path=Doku/SUPPN/APL/NVt-14/Zeilerweg-11&file=NVt-14_Zeilerweg-11_Metrierung_...jpg
Headers: x-user-email, x-user-role
```

---

## Data Model

### Schema Columns

APL uses columns from **multiple schema groups**:

#### Splicing group (via `findColumnId('splicing', ...)`)

| Column label fragment | Purpose | Written value |
|-----------------------|---------|---------------|
| `'apl status'` | Status | `"Done"` / `"Error"` / `""` |
| `'apl-termin'` | Appointment | `'{"date":"2026-04-15","time":"09:00","notes":"..."}'` |
| `'number of splices'` | Splice count | e.g. `"72"` |
| `'apl folder path'` or similar | Folder reference | `"Doku/SUPPN/APL/NVt-14/Zeilerweg-11/"` |
| `'knotenpunkt status'` | (read) Used for OTDR auto-trigger check | read-only in APL |

#### Timing group (via `findColumnId('timing', ...)`)

| Column label fragment | Purpose | Written value |
|-----------------------|---------|---------------|
| `'date'` | Work date | `"2026-04-14"` |
| `'time'` | Work time | `"14:30"` |

#### Notes group (via `findColumnId('notes', ...)`)

| Column label fragment | Purpose | Format |
|-----------------------|---------|--------|
| `'error-reporting'` | Error log | `"APL:desc;APL:desc#;"` |

#### Eigentümer group (via `findColumnId('eigentümer', ...)`)

| Column label fragment | Used for |
|-----------------------|---------|
| `'name'` | Owner names (display only) |
| `'phone'` | Phone numbers (display + tel: links) |
| `'email'` | Email addresses (display + mailto: links) |

### Status Behavior

| Aufmass value | Badge | Buttons |
|---------------|-------|---------|
| `"Done"` | Green "Done" | Appointment disabled; "Re-upload/Edit" instead of upload |
| `"Error"` | Red "⚠ Error" | Upload enabled; "Clear Error" visible |
| `""` or anything else | Gray "Pending" | Upload enabled; "Mark Appointment" |

### File Naming

```
{KNOTENPUNKT}_{AddressClean}_{ImageType}_{YYYYMMDD}_{HHmmss}[_U].{ext}
```

- `AddressClean`: `cleanAddress(address.end)` — strips city prefix, replaces spaces with hyphens
- `_U` suffix: added when `fileSources[i] === 'upload'` (device upload, not GeoCam)

Real examples:
```
NVt-14_Zeilerweg-11_Metrierung_20260414_143022.jpg          ← camera
NVt-14_Zeilerweg-11_APL_Box_20260414_143022_U.jpg           ← uploaded
NVt-14_Zeilerweg-11_Splices_20260414_143025.jpg             ← camera
NVt-14_Zeilerweg-11_Inside_APL_20260414_143027_U.jpg        ← uploaded
```

Extra images keep their original filenames.

### Storage Path

```
STORAGE_ROOT/
└── {PROJECT}/
    └── Doku/
        └── {CLUSTER}/
            └── APL/
                └── {KNOTENPUNKT}/
                    └── {AddressClean}/         ← per-address subfolder
                        ├── NVt-14_Zeilerweg-11_Metrierung_...jpg
                        ├── NVt-14_Zeilerweg-11_APL_Box_...jpg
                        ├── NVt-14_Zeilerweg-11_Splices_...jpg
                        ├── NVt-14_Zeilerweg-11_Inside_APL_...jpg
                        └── extra_photo.jpg
```

---

## Error Reporting

| Action | Column | Format |
|--------|--------|--------|
| Report error | `error-reporting` | Appends `APL:{description};` |
| Status after report | APL status | `"Error"` |
| Clear error (fix) | `error-reporting` | Last unfixed entry gets `#` appended: `APL:desc#;` |
| Status after last error fixed | APL status | `""` (Pending) |

Parsing:
```js
const aplErrors = errLog.split(';').filter(p => p.startsWith('APL:'));
const active = aplErrors.filter(p => !p.endsWith('#'));
const fixed  = aplErrors.filter(p => p.endsWith('#'));
```

When last file is deleted, ALL APL errors are stripped from the error-reporting column:
```js
const stripped = parts.filter(p => !p.startsWith('APL:'));
clearUpdates[erc] = stripped.length ? stripped.join(';') + ';' : '';
```

---

## Permissions / ACL

- Project access required
- `apl` module access required for navigation and upload
- Edit permission required for upload and aufmass writes
- ACL check: `canAccessModule(email, project, 'apl')`
- File upload fallback check: `canAccessModule(email, project, 'files')` (OR logic)

---

## Dependencies

- Aufmass data file must exist
- Schema must have: `splicing` group (with apl status, apl-termin, splice count columns), `timing` group, `notes` group (error-reporting column), optionally `eigentümer` group
- Schema must have `Cluster` + `Knotenpunkt` navigation columns
- `geocam.js` must be loaded on the page for camera functionality (falls back to file picker if not available)
- `appointment-shared.js` must be loaded before `apl.js`
- HTTPS or localhost required for `navigator.mediaDevices.getUserMedia` (camera) and `navigator.geolocation` (GPS)

---

## Code Walkthrough

### `cleanAddress(address)`

```js
function cleanAddress(address) {
    if (!address) return 'Unknown';
    let clean = address.trim();
    if (clean.includes(',')) clean = clean.split(',').pop().trim();
    // "Laichingen, Zeilerweg 11" → "Zeilerweg 11"
    return clean.replace(/\s+/g, '-').replace(/,/g, '');
    // → "Zeilerweg-11"
}
```

### `buildCustomerHTML(address)`

Reads three columns from the `eigentümer` schema group:
```js
const nameColId  = nav.findColumnId('eigentümer', 'name');
const phoneColId = nav.findColumnId('eigentümer', 'phone');
const emailColId = nav.findColumnId('eigentümer', 'email');
```

Splits multi-value fields:
- Names: `split(/\s+o\.\s+|,\s*|\s+und\s+/)`
- Phones: `split(/\s+o\.\s+/)`  — German "oder" (or)
- Emails: `split(/[;|]|\s+o\.\s+/)`

Each phone number is stripped to digits for `tel:` href but displayed as-is.

### `wireZones()`

Registers event listeners for all 4 image zones. Key: `setZoneFile(i, file, source)` vs `clearZoneFile(i)`.

The `source` parameter is critical:
- `'camera'` → GeoCam result → no `_U` suffix on upload
- `'upload'` → file picker or drag-drop → `_U` suffix on upload

### `GeoCam.capture(options)` — Internal Flow

```
1. loadSettings() from localStorage
2. getUserMedia({ video: { facingMode: 'environment' } })
3. navigator.geolocation.watchPosition() → live position updates
4. reverseGeocode(lat, lng) → /api/geocode proxy → Nominatim
5. requestAnimationFrame loop → stampFrame(video, settings, geo, now)
   - Canvas 2D context draws video frame
   - Builds overlay text lines from enabled fields (sorted by order)
   - Draws text/logo at configured position
   - Displays on <canvas> element in overlay
6. Shutter click → canvas.toBlob('image/jpeg', 0.92)
7. Preview screen with blob → "Use Photo" → resolve({blob, metadata})
```

`metadata` object returned:
```js
{
    timestamp: Date,        // capture time
    lat: 48.123456,
    lng: 9.876543,
    altitude: 456.7,
    address: { street, city, country, full },
    hash: "abc123..."       // SHA-256 of blob, only if enableHash=true
}
```

### GeoCam GPS Caching

Position is cached for 30 minutes (`GEO_CACHE_KEY = 'geocam-pos-v1'`). If cache is fresh, geolocation.getCurrentPosition is skipped.

Geocode responses are debounced: no re-request if within 0.0005° of last position and within 10 seconds.

### `injectFilesSection()` — Address Filter Logic

Files are fetched for the full knotenpunkt path, then filtered by address string:
```js
const clean = addrFilter.trim().replace(/\s+/g, '-').replace(/,/g, '');
// clean = "Zeilerweg-11"
files = files.filter(f => {
    const idx = f.name.indexOf(clean);
    if (idx === -1) return false;
    const afterIdx = idx + clean.length;
    if (afterIdx >= f.name.length) return true;
    const next = f.name[afterIdx];
    return next === '.' || next === '_' || next === '-' || next === ' ';
    // Prevents "Zeilerweg-11" matching "Zeilerweg-119"
});
```

### OTDR Auto-Trigger (Server Side)

When `/api/modules/aufmass-update` sets APL status to `"Done"`:
- Server checks if the **Knotenpunkt Status** for the same row is also `"Done"`
- If both are Done: automatically sets OTDR status → `"Waiting"`

This means OTDR becomes actionable without manual intervention. Documented in `otdr.js` comments:
```
// Auto-trigger (server side): When APL status AND Knotenpunkt Status → Done,
//   server automatically sets OTDR status → "Waiting".
```
