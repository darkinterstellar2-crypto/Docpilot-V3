# module-shared.js — ModuleNavigator

**File:** `src/js/module-shared.js`  
**Purpose:** Shared navigation + upload class used by Druckprüfung, Einblasen, Kalibrieren, APL, OTDR, Knotenpunkt Vorbereitung.

---

## Overview

`ModuleNavigator` is a self-contained JavaScript class that handles:
1. Loading the navigation tree (Cluster → Knotenpunkt → Address) from the backend
2. Rendering the navigation UI at each level
3. Standard PDF upload form with drag-drop
4. Updating Aufmass columns after upload
5. File listing view for "Done" addresses

Every module instantiates one `ModuleNavigator` with a config object, calls `nav.init()`, and the class takes over from there.

---

## Constructor Config

```js
const nav = new ModuleNavigator({
    project:              string,    // project name from URL param
    moduleName:           string,    // display name, e.g. "Druckprüfung"
    moduleKey:            string,    // ACL key, e.g. "druckprufung"
    targetFolder:         string,    // storage folder name, e.g. "Druckprufung"
    groupLabel:           string,    // schema group label to resolve status/type/file columns
    typeOptions:          string[],  // dropdown options, e.g. ['12x10', '4x20', 'custom']
    useOriginalFilename:  boolean,   // if true, skip rename (keep original filename)
    filenamePattern:      function,  // (addr, type) => string — custom filename generator
    containers: {
        content:    HTMLElement,     // main content area
        breadcrumb: HTMLElement,     // breadcrumb container
    },
    onUploadComplete:     function,  // called after successful upload
    customUploadForm:     boolean,   // if true, skip renderUploadForm, call onAddressSelected instead
    onAddressSelected:    function,  // (cluster, knotenpunkt, address) => void
    addressFilter:        function,  // (addr) => boolean — filter address list
    skipAddressStep:      boolean,   // skip address level, go straight to knotenpunkt form
    onKnotenpunktSelected: function, // called when knotenpunkt selected (if skipAddressStep)
    extraFields:          Array,     // additional form fields (see below)
    moduleKey:            string,    // maps to access-control.json key
});
```

### `extraFields` Config

Each entry adds an extra input above the drop zone:

```js
{
    id:           string,   // HTML element ID
    label:        string,   // label text
    type:         string,   // input type: 'number', 'text', etc.
    placeholder:  string,
    required:     boolean,
    colLabel:     string,   // aufmass column to update with this value
    colGroup:     string,   // group label for column lookup
    alsoCopyTo: [{          // optional: also write this value to another column
        colGroup: string,
        colLabel: string,
    }]
}
```

---

## Public Methods

### `init()`
Fetches navigation data from `/api/modules/navigation?project=X&module=Y`, parses the schema, resolves column IDs, renders the cluster grid.

### `renderClusters(clusters)`
Renders a grid of cluster cards. Clicking one calls `_selectCluster`.

### `renderKnotenpunkte(cluster)`
Renders a grid of Knotenpunkt cards. Clicking calls `_selectKnoten`.

### `renderAddresses(cluster, kn, addresses)`
Renders the address list. Applies `addressFilter` if configured. Each row shows:
- Address end name
- Cable name + fiber type
- Done/Pending badge

### `renderUploadForm(addr)`
If status is "Done", delegates to `_renderFilesViewAsync`. Otherwise renders:
- Address detail card
- Type select (from `typeOptions`), custom type input if "custom" selected
- Any `extraFields`
- Drag-and-drop zone (PDF only, max 200 MB)
- Upload button (disabled until file selected)

### `renderUploadFormInto(targetEl, addr)`
Same as `renderUploadForm` but renders into a specific container element (used by Einblasen to inject the standard upload inside its own custom form).

### `handleUpload(file, addr, type, extraValues)`
Submits file to `/api/modules/upload`, then calls `_updateAufmass` to update status/type/file columns. Fires `onUploadComplete` on success.

### `findColumnId(groupLabel, colLabel)`
Searches the loaded schema for a column matching both group and column label (case-insensitive partial match). Returns `col-{g}-{c}` string or `null`.

### `updateBreadcrumb(parts)`
Updates the breadcrumb element with the given path parts, each part clickable to navigate back.

---

## Internal Methods

### `_selectCluster(cluster)`
Sets `currentCluster`, calls `renderKnotenpunkte` (or `onKnotenpunktSelected` if `skipAddressStep`).

### `_selectKnoten(kn)`
Sets `currentKnoten`. If `customUploadForm`, calls `onAddressSelected`. Otherwise calls `renderAddresses`.

### `_selectAddress(addr)`
Sets `currentAddress`. If `customUploadForm`, calls `onAddressSelected(cluster.name, kn.name, addr)`. Otherwise calls `renderUploadForm(addr)`.

### `_renderFilesViewAsync(addr)`
Async. Fetches file list from `/api/modules/list-files?project=X&path=<Cluster>/<targetFolder>/<Knotenpunkt>`, renders download list with thumbnails + "Edit / Re-upload" button.

### `_wireUploadForm(addr)`
Wires all event listeners on the upload form: drag-drop, file input, type select, extra fields, upload button click.

### `_updateAufmass(addr, type, filename, extraValues)`
POSTs to `/api/modules/aufmass-update` with status → `Done`, type column, file location column, and any extra field column updates.

### `_resolveColumnIds()`
After schema load: finds `statusColId`, `typeColId`, `fileColId` by matching `groupLabel` against schema groups.

### `_renderFileListHTML(files, project, docsPath)`
Renders a list of files with extension badge, size, and download button. Images get `data-auth-src` thumbnails loaded via authenticated fetch.

### `_loadAuthImages()` _(static)_
Iterates all `[data-auth-src]` elements, fetches with auth headers, creates blob URLs for `<img>` src.

### `_downloadFile(url, filename)` _(static)_
Authenticated file download via fetch → blob → anchor click.

---

## Upload Flow (Standard)

```
User selects address
    ↓
renderUploadForm(addr) — shows type dropdown + drop zone
    ↓
User picks type + drops PDF
    ↓
handleUpload(file, addr, type, extraValues)
    ↓
POST /api/modules/upload
    { project, targetPath, customName, files[] }
    ↓
POST /api/modules/aufmass-update
    { project, rowId, updates: { statusCol: "Done", typeCol: type, fileCol: path } }
    ↓
Re-renders to files view (since status is now "Done")
```

### File Naming

Default (when `useOriginalFilename: false`):
```
{cableName}_{moduleName}_{type}.pdf
```

When `useOriginalFilename: true`:
- File is saved with its original name (as uploaded).

Custom override: provide `filenamePattern: (addr, type) => string` in config.

---

## File Listing View

Shown when address status is "Done". Features:
- Fetches from `/api/modules/list-files?project=X&path={Cluster}/{targetFolder}/{Knotenpunkt}`
- Renders file rows with: thumbnail (images), type badge (PDFs), size, download button
- "Edit / Re-upload" button → calls `_renderUploadFormDirect(addr)` (bypasses the Done check)

---

## ACL Integration

- `moduleKey` is passed as `?module=` to `/api/modules/navigation` for backend ACL check
- The backend checks `canAccessModule(email, project, moduleKey)` before returning data
- Upload and update also verify module access on the backend

---

## Injected Styles

`module-shared.js` auto-injects a `<style id="module-shared-styles">` tag on first load containing CSS for:
- `.existing-files-list`, `.existing-file-row`, `.file-thumb-wrap`, `.file-thumb-sm`
- `.file-icon-badge`, `.file-name-wrap`, `.file-dl-btn`, `.glass-card`

---

## Key Code Files

- `src/js/module-shared.js` — full class (~970 lines)
- `routes/moduleRoutes.js` — all backend endpoints it calls
