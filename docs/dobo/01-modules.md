# DocPilot Modules — DoBo Reference

## Installation Workflow Order

Field technicians work through modules in this order for each address:

```
1. Einblasen (Cable Blowing)
2. Druckprüfung (Pressure Test)
3. Kalibrieren (Calibration)
4. APL (Fiber Closure)
5. Knotenpunkt-Vorbereitung (Node Prep + Splicing)
6. OTDR (Optical Test — unlocks only after APL + Splicing done)
```

---

## Module Details

### 🔵 Einblasen (Cable Blowing)
- **Page:** einblasen.html
- **What:** Upload PDF proof that fiber cable was blown into the conduit
- **Extra:** Can generate a protocol (Protokoll) with measurements and timestamps
- **Status flow:** Pending → Waiting (PDF uploaded) → Done

### 🔵 Druckprüfung (Pressure Test)
- **Page:** druckprufung.html
- **What:** Upload PDF of pressure test results confirming conduit is sealed
- **Simple:** Just upload → mark done

### 🔵 Kalibrieren (Calibration)
- **Page:** kalibrieren.html
- **What:** Upload calibration PDF for the cable/tools
- **Simple:** Just upload → mark done

### 🟡 APL (Fiber Closure / Abschlusspunkt Linientechnik)
- **Page:** apl.html
- **What:** Upload 4 photos of the APL closure (outside, inside, cable tray, label)
- **Extra:** Schedule appointment for the APL work (uses shared appointment system)
- **Status:** Pending → Waiting (appointment set) → Done (4 photos uploaded)
- **Important:** OTDR is LOCKED until APL is Done

### 🟡 Knotenpunkt-Vorbereitung (Node Prep + Splicing)
- **Page:** knotenpunkt-vorbereitung.html
- **What two parts:**
  1. NVT preparation photos (for the node/cabinet)
  2. Per-address splice photos (each fiber connection gets a photo)
- **Important:** OTDR is LOCKED until Splicing is Done

### 🔴 OTDR (Optical Time Domain Reflectometer Test)
- **Page:** otdr.html
- **What:** Upload OTDR measurement files (.pdf + .sor) for each fiber strand
- **Locked until:** Both APL and Splicing are marked Done
- **Most complex module:** Multiple file types, one per fiber/Adernpaar

### 📅 Planner
- **Page:** planner.html
- **What:** Day-view calendar showing all appointments across all modules
- **Cross-module:** Shows APL, Knotenpunkt, and other scheduled appointments

### 📁 Files
- **Page:** files.html
- **What:** General file manager — browse, upload, download, delete, restore from trash
- **Features:** NAS sync indicator, folder tree, drag-drop upload, share links

### 📊 Aufmass
- **Page:** aufmass.html
- **What:** The main measurement/status table — THE central hub
- **Shows:** All addresses in the project with status per module, measurements, notes
- **Key action:** Update address measurements, change status flags, add notes

---

## Status System

Each address in each module has a status:

| Status | Color | Meaning |
|--------|-------|---------|
| `pending` | 🟡 Gray/Yellow | Not started |
| `waiting` | 🔵 Blue | Waiting for something (material, technician, etc.) |
| `done` | 🟢 Green | Completed successfully |
| `error` | 🔴 Red | Problem occurred, needs attention |
| `n/a` | — Gray | Not applicable for this address |

---

## Navigation Pattern (Field Modules)

All field modules use the same 3-level drill-down:
1. **Cluster view** — grid of all clusters in the project
2. **Knotenpunkt view** — grid of all NVTs in that cluster
3. **Address list** — list of all addresses in that Knotenpunkt with status badges

The back button returns to the previous level.

---

## Permission Keys (ACL)

| Module | ACL Key | Default |
|--------|---------|---------|
| Aufmass | `aufmass` | all users |
| Einblasen | `einblasen` | all users |
| Druckprüfung | `druckprufung` | all users |
| Kalibrieren | `kalibrieren` | all users |
| APL | `apl` | all users |
| Knotenpunkt/Splicing | `knotenpunkt` | all users |
| OTDR | `otdr` | all users |
| Files | `files` | all users |
| Planner | `planner` | all users |
| Admin panel | `admin` | admin/superadmin only |
