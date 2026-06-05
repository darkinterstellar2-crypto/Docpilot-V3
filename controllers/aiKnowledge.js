/**
 * controllers/aiKnowledge.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive DocPilot knowledge base for DoBo (the built-in AI assistant).
 * Covers all modules, workflows, statuses, navigation, and common tasks.
 *
 * At startup, loads markdown files from docs/dobo/ and appends them to
 * APP_KNOWLEDGE so DoBo has access to full documentation.
 */

const fs = require('fs');
const path = require('path');

// Load docs/dobo/ markdown files synchronously at startup
function loadDoboDocs() {
    const doboDir = path.join(__dirname, '..', 'docs', 'dobo');
    if (!fs.existsSync(doboDir)) return '';
    const files = fs.readdirSync(doboDir)
        .filter(f => f.endsWith('.md'))
        .sort();
    return files.map(f => {
        try {
            return '\n\n---\n\n' + fs.readFileSync(path.join(doboDir, f), 'utf8');
        } catch (e) {
            return '';
        }
    }).join('');
}

const _doboDocs = loadDoboDocs();

const APP_KNOWLEDGE = `
# DocPilot — Complete Application Knowledge

## What is DocPilot?
DocPilot is a professional fiber-optic project management application used by field teams and project managers to track, record, and manage all stages of fiber-optic cable installation projects. It organizes work across multiple modules, each representing a stage in the installation workflow.

---

## Core Concepts

### Projects
- Each project represents a fiber-optic installation area (e.g., a district or city zone).
- Projects contain multiple addresses (called Adressen), each representing a building or endpoint.
- Addresses are organized into NVT groups (Netzverteiler — distribution nodes).
- Project status can be: Active, Paused, Completed, Planning.

### Addresses (Adressen)
- Each address has a unique ID, street name, and NVT assignment.
- Addresses move through multiple workflow modules.
- Each module tracks its own status per address.

### Statuses
- **Pending** (🟡): Work not yet started or data not yet entered.
- **Waiting** (🔵): Waiting for an external action (e.g., material, technician).
- **Done** (🟢): Module work completed successfully.
- **Error** (🔴): A problem occurred that needs attention.
- **N/A**: Module not applicable for this address.

---

## Dashboard

The Dashboard is the main hub. From here you can:
- See all your assigned projects.
- Click a project to open it.
- View project status and last-updated information.
- (With permission) Create, delete, or reorder projects.
- Download project ZIP archives (with permission).
- Access all project modules via the sidebar or module tabs.

Navigation: The sidebar on the left shows all available modules for the current project. Clicking a module navigates directly to it.

---

## Module Workflows

### 1. APL (Abschlusspunkt Linientechnik)
The APL module tracks the physical installation of APL boxes at addresses.

**Workflow:**
1. Select an address from the address list.
2. Check if the APL position is confirmed — enter the exact location (e.g., "Keller, Raum 2").
3. Record the APL serial number or equipment code.
4. Mark installation date.
5. Upload a photo if available.
6. Set status to Done when APL is physically installed.

**Common fields:** Position, Serial number, Installation date, Notes, Photo.
**Status meanings:**
- Pending: APL not yet installed.
- Waiting: Waiting for APL delivery or access to the building.
- Done: APL installed and recorded.
- Error: Installation problem — check notes.

---

### 2. Einblasen (Cable Blowing)
Tracks the process of blowing fiber-optic cable through conduits.

**Workflow:**
1. Select the address.
2. Confirm conduit route is clear and pre-installed.
3. Record blow date and technician.
4. Enter cable length blown (in meters).
5. Note any obstacles encountered.
6. Set status to Done when cable is successfully blown through.

**Common fields:** Blow date, Cable length (m), Technician, Obstacles, Notes.
**Status meanings:**
- Pending: Cable not yet blown.
- Waiting: Conduit not ready, or equipment unavailable.
- Done: Cable successfully blown.
- Error: Cable blocked, conduit issue, or measurement mismatch.

**Tips:**
- If the cable gets stuck, document the exact position (in meters) in Notes.
- Always verify the blown length matches the planned route length.

---

### 3. Druckprüfung (Pressure Testing)
Verifies conduit integrity via air pressure testing before and after cable installation.

**Workflow:**
1. Select the address.
2. Record the initial pressure reading (bar).
3. Wait the specified hold time (typically 10-30 minutes).
4. Record the final pressure reading.
5. If pressure drop is within acceptable range → Done.
6. If pressure drops too much → Error (conduit leaking).

**Common fields:** Initial pressure, Final pressure, Hold time, Test date, Technician, Result.
**Status meanings:**
- Pending: Test not yet performed.
- Waiting: Waiting for conduit completion or equipment.
- Done: Test passed (pressure held).
- Error: Pressure dropped — conduit has a leak.

**Tips:**
- Acceptable pressure drop is typically < 0.1 bar over 10 minutes (check project specs).
- Always note the exact test date and technician name.

---

### 4. Kalibrieren (Calibration)
Optical calibration/measurement of the fiber-optic cable after installation.

**Workflow:**
1. Select the address.
2. Connect calibration equipment to the cable end.
3. Run calibration measurement.
4. Record measurement results (dB loss, length, reflections).
5. Compare against project thresholds.
6. If within spec → Done. If out of spec → Error.

**Common fields:** Measurement date, dB loss, Cable length (measured), Reference value, Pass/Fail, Technician, Notes.
**Status meanings:**
- Pending: Calibration not yet done.
- Waiting: Cable not yet blown/accessible.
- Done: Calibration passed.
- Error: Signal loss too high or measurement out of spec.

**Tips:**
- Always record both the expected and measured values.
- If Error: check for damaged cable, bad connectors, or dirt on fiber end.

---

### 5. Knotenpunkt / NVT & Splicing
Tracks splicing work at distribution nodes (NVT — Netzverteiler).

**Workflow:**
1. Select an NVT from the NVT list.
2. View all addresses assigned to this NVT.
3. For each fiber: record splice quality, splice loss (dB), and fusion number.
4. Document tray layout and fiber routing in the NVT enclosure.
5. Mark each splice as Done when complete.
6. When all fibers in an NVT are spliced → NVT is Done.

**Common fields:** NVT name, Splice date, Fiber number, Splice loss, Fusion machine ID, Tray number, Technician.
**Status meanings:**
- Pending: Splicing not started for this NVT.
- Waiting: Waiting for cable to arrive at NVT or for equipment.
- Done: All fibers spliced and verified.
- Error: Splice loss too high or splice failed.

**Tips:**
- Typical acceptable splice loss: < 0.1 dB per splice.
- Always verify fusion machine ID for traceability.

---

### 6. OTDR (Optical Time-Domain Reflectometer)
OTDR testing to verify full cable route integrity after splicing.

**Workflow:**
1. Select the address or cable segment to test.
2. Connect OTDR equipment to the fiber.
3. Run OTDR measurement scan.
4. Export/upload the OTDR trace file (.sor or .pdf).
5. Record key measurements: total loss, length, events.
6. Review trace for anomalies (reflections, breaks, high loss events).
7. If acceptable → Done. If anomaly found → Error.

**Common fields:** Test date, Total loss (dB), Cable length (km), Trace file, Events, Pass/Fail, Technician.
**Status meanings:**
- Pending: OTDR test not yet performed.
- Waiting: Splicing not complete, or equipment unavailable.
- Done: OTDR test passed.
- Error: Anomaly found in trace — investigate.

**Tips:**
- Upload the actual .sor or .pdf trace file for each test for documentation.
- OTDR must be run from both ends for a complete picture.

---

### 7. Files (Dateimanager)
Project file storage and management.

**Features:**
- Upload files to any project folder (plans, reports, photos, OTDR traces, etc.).
- Create subfolders to organize documents by type or date.
- Preview supported file types (PDF, images) directly in the browser.
- Download individual files or entire folders as ZIP.
- Share files via secure link (if enabled).
- Delete files (requires edit permission).

**How to upload:**
1. Navigate to Files for your project.
2. Select or create the target folder.
3. Click "Upload" and select files from your device.
4. Files appear in the folder immediately.

**How to share:**
1. Right-click (or use the menu icon) on a file.
2. Select "Share".
3. Copy the generated share link.
4. The link can be accessed without login (time-limited).

---

### 8. Planner
Visual project planning and scheduling tool.

**Features:**
- Gantt-style timeline view of project tasks.
- Assign tasks to team members.
- Set start and end dates for each task/phase.
- Track completion percentage per task.
- Filter by team member or project phase.
- Export planner as PDF or Excel.

**How to create a task:**
1. Click "Add Task".
2. Enter task name, start date, end date.
3. Assign to a team member.
4. Set initial completion %.
5. Save — the task appears on the timeline.

**How to update progress:**
1. Click the task on the timeline.
2. Update the completion % slider.
3. Add notes if needed.
4. Save changes.

---

## Aufmass Table
The Aufmass table is the main data grid for a project's measurement records.

- Each row represents an address/building.
- Columns show data fields (cable length, conduit type, floor count, etc.).
- Click any cell to edit (requires edit permission).
- Use the filter bar to search by address, NVT, or any field value.
- Sort columns by clicking the column header.
- Export the entire table as Excel with the Export button.
- The table auto-saves changes — no need to click Save.

**Status column:** Shows the overall status of each address across all modules. Quick visual overview of project progress.

---

## Navigation

### Main Navigation
- **Dashboard** — Project overview and list.
- **Aufmass** — Data table for measurements.
- **APL** — APL installation tracking.
- **Einblasen** — Cable blowing.
- **Druckprüfung** — Pressure testing.
- **Kalibrieren** — Calibration.
- **NVT & Splicing** — Splice tracking.
- **OTDR** — OTDR test management.
- **Files** — Document management.
- **Planner** — Project scheduling.
- **Chat** — Team communication per project.

### Header Menu
- **Profile** — Your account settings, name, password change.
- **Logout** — End your session.
- **Admin** (admin/superadmin only) — User management, permissions, system settings.

---

## Profile Page
- Change your display name.
- Update your password (requires current password confirmation).
- Set your preferred language (if supported).
- View your active sessions.
- See your role and assigned permissions.

---

## Admin Features (for authorized users)
- **User Management:** Approve/reject registration requests, suspend users, reset passwords.
- **Access Control:** Assign project access, module visibility, and edit permissions per user.
- **Project Management:** Create new projects, archive, delete (with confirmation).
- **System Settings:** Configure app-level settings.
- **Logs:** View activity logs and system events.
- **NAS Sync:** Monitor file synchronization status.

---

## Common Tasks & How-To

### How to mark an address as Done in a module
1. Open the module (e.g., Einblasen).
2. Find and click the address in the list.
3. Fill in all required fields.
4. Change the status dropdown to "Done".
5. Click Save or the status turns green automatically.

### How to filter the address list
- Use the search bar at the top of any module to filter by address name or NVT.
- Click column headers in the Aufmass table to sort.
- Use the status filter (🟡/🟢/🔴/🔵) to show only specific statuses.

### How to check project progress
1. Go to the Dashboard.
2. Click your project.
3. The progress overview shows % completion per module.
4. Or open the Aufmass table for row-by-row status.

### How to upload a file
1. Open Files module.
2. Navigate to the desired folder.
3. Click Upload (or drag & drop).
4. Select your file(s).
5. Files upload immediately.

### How to export data
- Aufmass table: Click "Export to Excel" button (top right of table).
- Planner: Click "Export PDF" or "Export Excel".
- Files: Download individual files or use "Download ZIP" for a folder.

### How to change a status back to Pending
1. Open the module for that address.
2. Click the status dropdown.
3. Select "Pending".
4. Save.

---

## Data Format (V2)

DocPilot stores project data internally in V2 format — a structured JSON array:

\`[E1, [E2_header, ...dataRows]]\`

- **E1**: Array of main column group names (e.g. ["Stammdaten", "Einblasen", "APL", "OTDR"])
- **E2_header**: Subcolumn definitions — one array per group, each entry is either a plain string (label) or an object \`{n: name, f: format}\`
- **dataRows**: Pure data rows — each row is an array of groups, each group is an array of cell values

**Format codes** (used in subcolumn definitions):
- \`Txt\`     — free text
- \`Num\`     — number
- \`Dat\`     — date
- \`Tim\`     — time
- \`Drp$...$\` — dropdown (options listed between $)
- \`Chk\`     — checkbox (true/false)

**Status values**: Done, Pending, Waiting, Error, N/A

This format is transparent to users — DocPilot handles all reading, writing, and migration automatically.

---

## Error Resolution

### Status shows Error
1. Click the address to open its detail view.
2. Read the Notes field for error description.
3. Fix the underlying issue (repair conduit, re-test, re-splice, etc.).
4. Update the fields with correct data.
5. Change status to Done (or Waiting if still pending external action).

### Can't edit data
- Check your permissions: you may not have edit access for this project.
- Contact your admin to enable edit permission.
- You may be logged in as a viewer-only account.

### File won't upload
- Check file size (max typically 100MB per file).
- Ensure file type is allowed (most types are supported).
- Check your storage quota with the admin.
- Try a different browser or clear cache.

### Session expired
- Your login expired after the session timeout.
- Log in again — your data is saved.

### Can't see a project
- The project may not be assigned to your account.
- Ask your admin to grant access to the project.
- Check if you're logged in with the correct account.
` + _doboDocs;

/**
 * Generate a concise text summary of project data for context injection.
 * @param {Object} projectData - Project data object from storage
 * @returns {string}
 */
function getProjectContext(projectData) {
    if (!projectData) return '';

    try {
        const lines = [];

        if (projectData.name) {
            lines.push(`Project: ${projectData.name}`);
        }

        if (projectData.status) {
            lines.push(`Status: ${projectData.status}`);
        }

        if (Array.isArray(projectData.addresses)) {
            const total = projectData.addresses.length;
            lines.push(`Total addresses: ${total}`);

            // Group by NVT if NVT field exists
            const nvtMap = {};
            for (const addr of projectData.addresses) {
                const nvt = addr.nvt || addr.NVT || 'Unknown NVT';
                if (!nvtMap[nvt]) nvtMap[nvt] = { total: 0, done: 0, error: 0, pending: 0, waiting: 0 };
                nvtMap[nvt].total++;
                const st = (addr.status || '').toLowerCase();
                if (st === 'done') nvtMap[nvt].done++;
                else if (st === 'error') nvtMap[nvt].error++;
                else if (st === 'waiting') nvtMap[nvt].waiting++;
                else nvtMap[nvt].pending++;
            }

            for (const [nvt, stats] of Object.entries(nvtMap)) {
                const parts = [`${stats.total} addresses`];
                if (stats.done) parts.push(`${stats.done} done`);
                if (stats.pending) parts.push(`${stats.pending} pending`);
                if (stats.waiting) parts.push(`${stats.waiting} waiting`);
                if (stats.error) parts.push(`${stats.error} errors`);
                lines.push(`  ${nvt}: ${parts.join(', ')}`);
            }

            // Overall stats
            const totalDone = projectData.addresses.filter(a => (a.status || '').toLowerCase() === 'done').length;
            const totalError = projectData.addresses.filter(a => (a.status || '').toLowerCase() === 'error').length;
            const pct = total > 0 ? Math.round((totalDone / total) * 100) : 0;
            lines.push(`Overall progress: ${pct}% complete (${totalDone}/${total} done, ${totalError} errors)`);
        }

        return lines.join('\n');
    } catch (_) {
        return '';
    }
}

/**
 * Get focused help text for a specific module.
 * @param {string} moduleName
 * @returns {string}
 */
function getModuleHelp(moduleName) {
    const helpMap = {
        apl: 'APL (Abschlusspunkt Linientechnik): Install and record APL boxes at addresses. Fill in position, serial number, date, and mark Done when installed.',
        einblasen: 'Einblasen (Cable Blowing): Record cable blowing operations. Enter the blow date, cable length, technician, and any obstacles.',
        druckprufung: 'Druckprüfung (Pressure Testing): Test conduit integrity. Record initial/final pressure readings and hold time. Pass = Done, Leak = Error.',
        kalibrieren: 'Kalibrieren (Calibration): Measure optical signal quality. Record dB loss and compare to thresholds.',
        knotenpunkt: 'NVT & Splicing: Track fiber splicing at NVT nodes. Record splice loss per fiber. All fibers spliced = NVT Done.',
        otdr: 'OTDR Testing: Run reflectometer tests and upload trace files. Verify full route integrity after splicing.',
        files: 'Files: Upload, organize, and share project documents. Supports all file types including plans, photos, and OTDR traces.',
        planner: 'Planner: Schedule tasks on a Gantt timeline. Assign tasks, set dates, and track completion percentage.',
        aufmass: 'Aufmass Table: The main data grid for all addresses. Edit cells, filter, sort, and export to Excel.',
    };

    return helpMap[moduleName?.toLowerCase()] || '';
}

module.exports = { APP_KNOWLEDGE, getProjectContext, getModuleHelp };
