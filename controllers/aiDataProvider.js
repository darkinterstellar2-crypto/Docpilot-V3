/**
 * controllers/aiDataProvider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY data context provider for DoBo.
 * Gives DoBo the same project data the logged-in user can see — summarised,
 * never dumped raw.
 *
 * ⛔ STRICTLY READ-ONLY — zero write operations, zero data modification.
 * ⛔ Respects ACL — only returns data the user has access to.
 * ⛔ Returns summaries (max ~2000 chars) — not raw data.
 * ⛔ Uses EXISTING file-access patterns from moduleRoutes.js / dataRoutes.js.
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');

const { getDatafileDir } = require('./storageConfig');
const { canAccessProject } = require('./accessControl');

// ─── File path resolution ─────────────────────────────────────────────────────
// Mirrors moduleRoutes.js getFilePath — same logic, same locations.

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the path for a project's aufmass data file.
 * Prefers the base ProjectName.txt; falls back to the latest versioned file.
 * Returns the base path (even if missing) so callers get a meaningful error.
 */
async function getFilePath(projectName) {
    if (!projectName) return null;
    const dir      = getDatafileDir(projectName);
    const basePath = path.join(dir, `${projectName}.txt`);

    // 1. Check base file
    try { await fs.access(basePath); return basePath; } catch (_) {}

    // 2. Scan for versioned files: ProjectName_YYYYMMDD_HHMMSS.txt
    try {
        const files          = await fs.readdir(dir);
        const versionPattern = new RegExp(`^${escapeRegex(projectName)}_(\\d{8}_\\d{6})\\.txt$`);
        const versioned      = files
            .map(f => ({ name: f, match: f.match(versionPattern) }))
            .filter(f => f.match)
            .sort((a, b) => b.match[1].localeCompare(a.match[1])); // newest first
        if (versioned.length > 0) return path.join(dir, versioned[0].name);
    } catch (_) {}

    return basePath; // fallback — will throw on readFile if truly missing
}

// ─── Data file parser ──────────────────────────────────────────────────────────
// Mirrors moduleRoutes.js parseDataFile.

async function parseDataFile(projectName) {
    const filePath    = await getFilePath(projectName);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const rawData     = JSON.parse(fileContent);
    if (!Array.isArray(rawData) || rawData.length < 2 || !Array.isArray(rawData[1])) {
        throw new Error('Unexpected data format');
    }
    const E1          = rawData[0];        // main column group names (array of strings)
    const E2          = rawData[1];        // [subcolDefs, ...dataRows]
    const E2_0        = E2[0];            // subcolumn definitions
    const dataRows    = E2.slice(1);      // actual data rows
    return { filePath, E1, E2_0, dataRows };
}

// ─── Column label helpers ──────────────────────────────────────────────────────

/**
 * Extract text label from a column definition.
 * Supports both plain strings and {n: name, f: format} objects.
 */
function getColLabel(col) {
    if (typeof col === 'string') return col;
    if (col && typeof col === 'object' && col.n) return col.n;
    return '';
}

/**
 * Find the first column matching a label predicate.
 * Returns { grpIdx, colIdx } or null.
 * Mirrors moduleRoutes.js findColByLabel.
 */
function findColByLabel(E2_0, labelFn) {
    for (let i = 0; i < E2_0.length; i++) {
        const cols = E2_0[i] || [];
        for (let j = 0; j < cols.length; j++) {
            const l = getColLabel(cols[j]).toLowerCase();
            if (labelFn(l)) return { grpIdx: i, colIdx: j };
        }
    }
    return null;
}

// ─── Status counting ───────────────────────────────────────────────────────────

function countStatuses(dataRows, grpIdx, colIdx) {
    const c = { Done: 0, Pending: 0, Waiting: 0, Error: 0, NA: 0 };
    dataRows.forEach(row => {
        const val = String(row[grpIdx]?.[colIdx] || '').trim();
        if      (val === 'Done')    c.Done++;
        else if (val === 'Waiting') c.Waiting++;
        else if (val === 'Error')   c.Error++;
        else if (val === 'N/A')     c.NA++;
        else                        c.Pending++;
    });
    return c;
}

function formatStatusCounts(c) {
    const parts = [];
    if (c.Done)    parts.push(`${c.Done} done`);
    if (c.Pending) parts.push(`${c.Pending} pending`);
    if (c.Waiting) parts.push(`${c.Waiting} waiting`);
    if (c.Error)   parts.push(`${c.Error} errors`);
    if (c.NA)      parts.push(`${c.NA} N/A`);
    return parts.join(', ') || 'no data';
}

// ─── Appointment summary ───────────────────────────────────────────────────────

/**
 * Summarise appointments for the planner page.
 * Scans all "termin" columns across the data file.
 * Returns a compact string or empty string if no appointments found.
 */
function buildAppointmentSummary(E1, E2_0, dataRows) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const clusterPos   = findColByLabel(E2_0, l => l === 'cluster');
        const addrStartPos = findColByLabel(E2_0, l => l === 'address start');

        // Find all termin columns across all groups
        const terminCols = [];
        (E1 || []).forEach((groupLabel, gi) => {
            const groupName = String(groupLabel || '');
            (E2_0[gi] || []).forEach((col, ci) => {
                if (getColLabel(col).toLowerCase().includes('termin')) {
                    terminCols.push({ grpIdx: gi, colIdx: ci, groupName });
                }
            });
        });

        if (terminCols.length === 0) return '';

        const todayAppts    = [];
        const upcomingAppts = [];
        const overdueAppts  = [];

        dataRows.forEach(row => {
            const cluster = clusterPos
                ? String(row[clusterPos.grpIdx]?.[clusterPos.colIdx] || '').trim()
                : '';
            const addr    = addrStartPos
                ? String(row[addrStartPos.grpIdx]?.[addrStartPos.colIdx] || '').trim()
                : '';
            const label   = [cluster, addr].filter(Boolean).join('/') || 'unknown';

            terminCols.forEach(tc => {
                const rawVal = row[tc.grpIdx]?.[tc.colIdx];
                if (!rawVal) return;
                let parsed;
                try { parsed = JSON.parse(rawVal); } catch { return; }
                if (!parsed || !parsed.date) return;

                const d = new Date(parsed.date);
                d.setHours(0, 0, 0, 0);
                const diff = Math.round((d - today) / 86_400_000);
                const timeStr = parsed.time ? ` ${parsed.time}` : '';
                const entry   = `${tc.groupName} @ ${label} (${parsed.date}${timeStr})`;

                if      (diff === 0)           todayAppts.push(entry);
                else if (diff > 0 && diff <= 7) upcomingAppts.push(entry);
                else if (diff < 0)             overdueAppts.push(entry);
            });
        });

        const parts = [];
        if (todayAppts.length)
            parts.push(`Today (${todayAppts.length}): ${todayAppts.slice(0, 3).join('; ')}`);
        if (upcomingAppts.length)
            parts.push(`Next 7 days (${upcomingAppts.length}): ${upcomingAppts.slice(0, 3).join('; ')}`);
        if (overdueAppts.length)
            parts.push(`Overdue (${overdueAppts.length}): ${overdueAppts.slice(0, 3).join('; ')}`);

        return parts.length > 0
            ? `Appointments:\n  ${parts.join('\n  ')}`
            : 'No appointments in the next 7 days.';
    } catch (_) {
        return '';
    }
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * getPageContext(user, projectId, page, module)
 *
 * Returns a compact, ACL-respecting summary of the project data for DoBo.
 * Always returns a string — empty string on any error or access denial.
 * Maximum ~2000 characters to avoid bloating the system prompt.
 *
 * @param {{ email: string, role: string }} user
 * @param {string} projectId   - Project name
 * @param {string} [page]      - Current page (e.g. 'aufmass', 'planner', 'einblasen')
 * @param {string} [module]    - Current module key
 * @returns {Promise<string>}
 */
async function getPageContext(user, projectId, page, module) {
    if (!projectId || !user || !user.email) return '';

    const userEmail = user.email;
    const userRole  = (user.role || '').toLowerCase();

    // ── ACL check ──────────────────────────────────────────────────────────
    // Skip for superadmin; check canAccessProject for all others.
    if (userRole !== 'superadmin') {
        try {
            const ok = await canAccessProject(userEmail, projectId);
            if (!ok) return '';
        } catch (_) {
            return ''; // ACL error → deny silently
        }
    }

    // ── Parse data file ────────────────────────────────────────────────────
    let E1, E2_0, dataRows, filePath;
    try {
        ({ filePath, E1, E2_0, dataRows } = await parseDataFile(projectId));
    } catch (_) {
        return ''; // No data file yet or parse error → silent fail
    }

    const totalRows = dataRows.length;

    // ── Cluster distribution ───────────────────────────────────────────────
    const clusterPos    = findColByLabel(E2_0, l => l === 'cluster');
    const clusterCounts = {};
    if (clusterPos) {
        dataRows.forEach(row => {
            const val = String(row[clusterPos.grpIdx]?.[clusterPos.colIdx] || '').trim();
            if (val) clusterCounts[val] = (clusterCounts[val] || 0) + 1;
        });
    }

    // ── Module status columns ──────────────────────────────────────────────
    // Find every column whose label is exactly "Status" or ends with " Status".
    // Group by the E1 group name (Einblasen, APL, OTDR, etc.).
    const moduleStatuses = []; // [{ groupName, counts }]
    (E1 || []).forEach((groupLabel, gi) => {
        const groupName = String(groupLabel || '').trim();
        const cols      = E2_0[gi] || [];
        cols.forEach((col, ci) => {
            const label = getColLabel(col).toLowerCase();
            if (label === 'status' || label.endsWith(' status')) {
                moduleStatuses.push({
                    groupName,
                    counts: countStatuses(dataRows, gi, ci),
                });
            }
        });
    });

    // ── Last modified date ─────────────────────────────────────────────────
    let lastModified = '';
    try {
        const stat   = await fs.stat(filePath);
        lastModified = stat.mtime.toISOString().slice(0, 10);
    } catch (_) {}

    // ── Build summary ──────────────────────────────────────────────────────
    const lines = [];

    // Header line
    const clusterKeys = Object.keys(clusterCounts);
    if (clusterKeys.length > 0) {
        const clusterStr = clusterKeys.map(c => `${c}: ${clusterCounts[c]}`).join(', ');
        lines.push(`Project: ${projectId} | ${totalRows} rows | Clusters: ${clusterStr}`);
    } else {
        lines.push(`Project: ${projectId} | ${totalRows} rows`);
    }

    if (lastModified) lines.push(`Last updated: ${lastModified}`);

    // Column group names
    const groupNames = (E1 || []).map(g => String(g || '').trim()).filter(Boolean);
    if (groupNames.length > 0) {
        lines.push(`Column groups: ${groupNames.join(', ')}`);
    }

    // Module status overview (all modules)
    if (moduleStatuses.length > 0) {
        lines.push('Module statuses:');
        moduleStatuses.forEach(({ groupName, counts }) => {
            lines.push(`  ${groupName || '(unnamed)'}: ${formatStatusCounts(counts)}`);
        });
    }

    // ── Page-specific additions ────────────────────────────────────────────

    // Planner: add appointment summary
    if (page === 'planner') {
        const apptSummary = buildAppointmentSummary(E1, E2_0, dataRows);
        if (apptSummary) lines.push('\n' + apptSummary);
    }

    // Module pages: highlight the relevant module's stats more prominently
    const focusPage = (page || module || '').toLowerCase().replace(/-/g, '');
    if (focusPage && focusPage !== 'aufmass' && focusPage !== 'dashboard' && focusPage !== 'planner') {
        const relevant = moduleStatuses.find(s => {
            const n = s.groupName.toLowerCase().replace(/\s+/g, '').replace(/ü/g, 'u').replace(/ä/g, 'a');
            return n.includes(focusPage) || focusPage.includes(n.slice(0, 5));
        });
        if (relevant) {
            lines.push(`\nCurrent module focus (${page || module}): ${formatStatusCounts(relevant.counts)}`);
        }
    }

    return lines.join('\n').substring(0, 2000);
}

module.exports = { getPageContext };
