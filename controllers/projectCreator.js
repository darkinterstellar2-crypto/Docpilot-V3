// PostgreSQL migration: 2026-06-10
const fs = require('fs').promises;
const path = require('path');
const { setFileMeta } = require('./fileMeta');

// Centralized path resolution — single source of truth
const { getProjectRoot } = require('./storageConfig');

const db = require('./db');
const TENANT_ID = process.env.TENANT_ID || 'REPLACE-WITH-GEGGOS-TENANT-UUID';

async function createProjectStructure(projectName, locations, schemaData, customStructure) {
    try {
        const projectPath = getProjectRoot(projectName);
        
        // 1. Base Folders
        await fs.mkdir(path.join(projectPath, 'Pläne'), { recursive: true });
        await setFileMeta(projectName, 'Pläne', 'Automated-System');
        const dokuPath = path.join(projectPath, 'Doku');
        await fs.mkdir(dokuPath, { recursive: true });
        await setFileMeta(projectName, 'Doku', 'Automated-System');

        // 2. Master Aufmass Folder
        await fs.mkdir(path.join(dokuPath, 'Aufmass', 'datafile'), { recursive: true });
        await fs.mkdir(path.join(dokuPath, 'Aufmass', 'xlsx'), { recursive: true });
        await setFileMeta(projectName, 'Doku/Aufmass', 'Automated-System');
        await setFileMeta(projectName, 'Doku/Aufmass/datafile', 'Automated-System');
        await setFileMeta(projectName, 'Doku/Aufmass/xlsx', 'Automated-System');

        // Initialize the single master data file for the entire project
        const txtFilePath = path.join(dokuPath, 'Aufmass', 'datafile', `${projectName}.txt`);

        // Always include hidden Identification group as first element
        // dataRoutes.js expects row[0][0] to be the Unique Project ID
        const fullSchema = [
            { title: 'Identification', cols: ['Unique Project ID', 'Metadata'] },
            ...schemaData
        ];
        const E1 = fullSchema.map(g => g.title);
        const E2_0 = fullSchema.map(g => g.cols);
        
        await fs.writeFile(txtFilePath, JSON.stringify([E1, [E2_0]], null, 2), 'utf-8');
        await setFileMeta(projectName, `Doku/Aufmass/datafile/${projectName}.txt`, 'Automated-System');

        // 3. Loop through and create specific Location folders
        for (const loc of locations) {
            const locPath = path.join(dokuPath, loc);
            
            // Recursive folder builder — supports unlimited nesting
            async function buildFolders(parentFs, parentRel, nodes) {
                for (const node of nodes) {
                    // Support both old format (string children) and new format (object children)
                    const name = typeof node === 'string' ? node : node.name;
                    const children = typeof node === 'string' ? [] : (node.children || []);
                    const fsPath = path.join(parentFs, name);
                    const relPath = `${parentRel}/${name}`;
                    await fs.mkdir(fsPath, { recursive: true });
                    await setFileMeta(projectName, relPath, 'Automated-System');
                    if (children.length > 0) {
                        await buildFolders(fsPath, relPath, children);
                    }
                }
            }

            // If customStructure provided from UI, build it
            if (customStructure && customStructure.length > 0) {
                await buildFolders(locPath, `Doku/${loc}`, customStructure);
            } else {
                // Fallback to default
                const foldersToCreate = [
                    'Einblasen/BB', 'Einblasen/HA', 'Einblasen/NVT',
                    'OTDR/NVT', 'OTDR/SCT', 'APL/NVT', 'APL/SCT',
                    'Knotenpunkt_Vorbereitung', 'POP_details', 'SCT_details',
                    'kalibrieren', 'Druckprufung'
                ];
                for (const folder of foldersToCreate) {
                    await fs.mkdir(path.join(locPath, folder), { recursive: true });
                    await setFileMeta(projectName, `Doku/${loc}/${folder}`, 'Automated-System');
                }
            }
            await setFileMeta(projectName, `Doku/${loc}`, 'Automated-System');
        }

        // 4. Save to PostgreSQL
        await db.transaction(async (client) => {
            const projResult = await client.query(
                `INSERT INTO projects (tenant_id, name, status, storage_path)
                 VALUES ($1, $2, 'active', $3)
                 RETURNING id`,
                [TENANT_ID, projectName, projectPath]
            );
            const projectId = projResult.rows[0].id;

            for (let i = 0; i < locations.length; i++) {
                await client.query(
                    `INSERT INTO project_clusters (tenant_id, project_id, name, sort_order)
                     VALUES ($1, $2, $3, $4)`,
                    [TENANT_ID, projectId, locations[i], i]
                );
            }
        });

        return { success: true, path: projectPath };
    } catch (error) {
        console.error("Error creating project tree:", error);
        let friendlyMessage = error.message;
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
            friendlyMessage = `Storage root not accessible. Check STORAGE_ROOT is set correctly in your .env file.`;
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            friendlyMessage = `Permission denied writing to storage. Run the app with sufficient permissions or check folder access rights.`;
        }
        return { success: false, error: friendlyMessage };
    }
}

module.exports = { createProjectStructure };
