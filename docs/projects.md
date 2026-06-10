# Projects

## Overview

A project in DocPilot represents a fiber optic construction job (e.g., a city/region build-out). Projects contain clusters, Knotenpunkte, addresses, and all associated documentation files.

## Creating a Project

**Page:** `new-project.html` | **JS:** `src/js/new-project.js` | **API:** `POST /api/projects/create`

### Required Inputs

| Field | Description |
|-------|-------------|
| `projectName` | Unique project name (case-insensitive uniqueness check) |
| `locations` | Array of cluster names (at least one required) |
| `schema` | Array of column group definitions (loaded from `schema.json` or customized) |

### Optional Inputs

| Field | Description |
|-------|-------------|
| `structure` | Custom folder structure (nested objects with `name` and `children`) |
| `description` | Project description text |
| `fields` | Custom key-value metadata fields (e.g., client name, contract number) |

### What Happens on Create

**File:** `controllers/projectCreator.js`

1. **Base folders created:**
   ```
   storage/<ProjectName>/
   ├── Doku/
   │   └── Aufmass/
   │       ├── datafile/
   │       └── xlsx/
   └── Pläne/
   ```

2. **Data file initialized:** `storage/<ProjectName>/Doku/Aufmass/datafile/<ProjectName>.txt`
   - Contains the schema with an empty data array
   - Always includes a hidden "Identification" group as the first element (for row IDs)

3. **Location folders created:** For each cluster name in `locations`:
   ```
   storage/<ProjectName>/Doku/<ClusterName>/
   ├── APL/
   ├── Druckprufung/
   ├── Einblasen/BB/
   ├── Einblasen/HA/
   ├── Einblasen/NVT/
   ├── kalibrieren/
   ├── Knotenpunkt_Vorbereitung/
   ├── OTDR/NVT/
   ├── OTDR/SCT/
   ├── APL/NVT/
   ├── APL/SCT/
   ├── POP_details/
   └── SCT_details/
   ```

   If `customStructure` is provided, it replaces the default folder list.

4. **Pläne folder:** `storage/<ProjectName>/Pläne/<ClusterName>/` for each cluster

5. **Database entry:** Project added to `projects.json`

6. **File metadata:** `.filemeta.json` entries created for all folders (tracked as "Automated-System")

7. **Project info saved:** If description or fields provided, saved to `project-info.json`

## Clusters

Clusters are geographical groupings within a project. They can come from three sources:

1. **Data file** (most authoritative) — extracted from the "Cluster" column in Aufmass data
2. **projects.json** — the `locations` array from project creation
3. **Filesystem** — subdirectories of `storage/<Project>/Doku/`

All three sources are merged when listing clusters (`GET /api/projects/:name/clusters`).

### Adding Clusters

`POST /api/projects/:name/clusters` with `{ name: "ClusterName" }`:
1. Adds to `projects.json` locations array
2. Creates folder structure via `folderSync.syncClusterFolders()`

### Folder Sync

**File:** `controllers/folderSync.js`

When Aufmass data is saved, the system automatically:
1. **Creates** folder structures for new clusters/Knotenpunkte found in the data
2. **Trashes** cluster folders that no longer appear in the data (moved to `.trash`)

This runs as a fire-and-forget background task after every data save.

## Knotenpunkte

Knotenpunkte (network junction points) exist within clusters. Like clusters, they come from:
1. **Data file** — the "Knotenpunkt" or "NVT" column
2. **Filesystem** — subdirectories of `storage/<Project>/Doku/<Cluster>/APL/`

### Adding Knotenpunkte

`POST /api/projects/:name/knotenpunkte` with `{ cluster, name }`:
- Creates sub-folders under each module folder:
  ```
  storage/<Project>/Doku/<Cluster>/APL/<KnotenpunktName>/
  storage/<Project>/Doku/<Cluster>/Druckprufung/<KnotenpunktName>/
  storage/<Project>/Doku/<Cluster>/Einblasen/<KnotenpunktName>/
  storage/<Project>/Doku/<Cluster>/kalibrieren/<KnotenpunktName>/
  storage/<Project>/Doku/<Cluster>/Knotenpunkt_Vorbereitung/<KnotenpunktName>/
  storage/<Project>/Doku/<Cluster>/OTDR/<KnotenpunktName>/
  ```

## Project Status

Projects have a user-defined status string. Common values: "Active", "Completed", "On Hold".

Changed via `POST /api/projects/status` with `{ projectName, newStatus }`. Requires `changeStatus` ACL permission.

## Project Reordering

Projects can be reordered on the Hub page via `POST /api/projects/reorder` with `{ projectName, direction: 'left'|'right' }`. Swaps the project with its neighbor in the `projects.json` array.

## Project Deletion

`POST /api/projects/remove` with `{ projectName }`:
1. Removes from `projects.json`
2. Physically deletes the `storage/<ProjectName>/` directory (using `fs.rmSync`)

> **Warning:** This is a permanent deletion. There is no recycle bin for project-level deletion (unlike file-level deletion which uses soft-delete).

## Project ZIP Download

`GET /api/projects/zip/:projectName`:
1. If NAS sync is enabled, first pulls any cleaned files back from NAS (60-second timeout)
2. Creates a ZIP archive of the entire project directory
3. Streams the ZIP to the client

Requires `downloadZip` ACL permission.

## Project Info

**File:** `routes/projectInfoRoutes.js`

Each project can have:
- A text description
- Custom key-value fields (e.g., "Client: Deutsche Telekom")
- A member list (auto-synced from ACL)

Accessible at `GET /api/project-info/:project`. Editable via `PUT /api/project-info/:project` (requires `editProjectInfo` ACL permission).

The member list endpoint `GET /api/project-info/:project/members` returns all users with access, including superadmins (who always have access) and ACL-granted users, enriched with names and avatars from `users.json`.
