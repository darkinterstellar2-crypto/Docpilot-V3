// PostgreSQL migration: 2026-06-10
// NOTE: Row versioning is now a column on aufmass_rows (version INTEGER).
// This file is kept as a stub for backward compatibility with imports
// (moduleRoutes.js and dataRoutes.js still import saveVersionedCopy for Excel exports).
//
// saveVersionedCopy — KEPT. Creates versioned .txt snapshots + XLSX exports on disk.
// Row version tracking removed from here — handled in dataRoutes.js directly via DB.

const fs = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');

/**
 * Save a versioned .txt copy and an Excel export alongside the main datafile.
 * (Filesystem only — not stored in DB. These are archival snapshots.)
 *
 * @param {string} filePath  - Absolute path to the main .txt file (already written)
 * @param {Array}  E1        - Main header labels array
 * @param {Array}  E2        - Full E2 array: [E2_0 (sub-headers), ...dataRows]
 * @returns {Promise<{versionedTxt, xlsxPath, timestamp}>}
 */
async function saveVersionedCopy(filePath, E1, E2) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.txt');

    // 1. Save versioned .txt copy
    const versionedTxt = path.join(dir, `${baseName}_${timestamp}.txt`);
    await fs.writeFile(versionedTxt, JSON.stringify([E1, E2], null, 2), 'utf-8');

    // 2. Create Excel export in xlsx/ folder (sibling of datafile/)
    const xlsxDir = path.join(dir, '..', 'xlsx');
    await fs.mkdir(xlsxDir, { recursive: true });

    const E2_0 = E2[0];
    const dataRows = E2.slice(1);
    const buffer = createExcelBuffer(E1, E2_0, dataRows);

    const xlsxPath = path.join(xlsxDir, `${baseName}_${timestamp}.xlsx`);
    await fs.writeFile(xlsxPath, buffer);

    return { versionedTxt, xlsxPath, timestamp };
}

function createExcelBuffer(E1, E2_0, dataRows) {
    const wb = XLSX.utils.book_new();

    const headers1 = [];
    const headers2 = [];
    E1.forEach((main, i) => {
        const cols = E2_0[i] || [];
        cols.forEach((sub, j) => {
            headers1.push(j === 0 ? (main || '') : '');
            headers2.push(sub || '');
        });
    });

    const rows = dataRows.map(row => {
        const flat = [];
        E1.forEach((_, i) => {
            const grp = row[i] || [];
            const cols = E2_0[i] || [];
            cols.forEach((_, j) => {
                flat.push(grp[j] != null ? String(grp[j]) : '');
            });
        });
        return flat;
    });

    const wsData = [headers1, headers2, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    const merges = [];
    let colOffset = 0;
    E1.forEach((_, i) => {
        const colCount = (E2_0[i] || []).length;
        if (colCount > 1) {
            merges.push({ s: { r: 0, c: colOffset }, e: { r: 0, c: colOffset + colCount - 1 } });
        }
        colOffset += colCount;
    });
    if (merges.length) ws['!merges'] = merges;

    XLSX.utils.book_append_sheet(wb, ws, 'Aufmass');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { saveVersionedCopy };
