# DocPilot Data Management — Sync Rules

## Terminology Changes
- "NVT" sub-column → "Knotenpunkt" 
- "Location" (in project creation) → "Cluster"
- "NVT_Details" folder → "Knotenpunkt_Vorbereitung"

## Rule 1: Cluster Sync
- Each Cluster in the aufmass data MUST have a matching folder in:
  - `Doku/[ClusterName]/`
  - `Pläne/[ClusterName]/`
- During project creation: user defines Clusters (was "Locations")
- During data entry: Cluster column has a DROPDOWN with existing clusters + "Add New Cluster" option
- If a new row contains a new Cluster → auto-create the folder structure for it
- Spelling protection: always use dropdown, manual typing disabled unless "Add New"

## Rule 2: Knotenpunkt/SCT Sync  
- Inside each Cluster folder, these sub-folders get per-Knotenpunkt folders:
  - `APL/[KnotenpunktName]/`
  - `Druckprufung/[KnotenpunktName]/`
  - `Einblasen/[KnotenpunktName]/`
  - `kalibrieren/[KnotenpunktName]/`
  - `Knotenpunkt_Vorbereitung/[KnotenpunktName]/`
  - `OTDR/[KnotenpunktName]/`
- When a new Knotenpunkt appears in aufmass → create its folders automatically
- Knotenpunkt column has a DROPDOWN filtered by selected Cluster + "Add New Knotenpunkt" option
- SCT works the same way (some folders have SCT sub-folders too: APL/SCT, OTDR/SCT)

## Rule 3: Fiber Type Dropdown
- Fiber type column: dropdown with fixed values: 6, 12, 24, 48, 96, 288
- No free-text entry

## Folder Structure Per Cluster
```
Doku/
  [ClusterName]/
    APL/
      [Knotenpunkt1]/
      [Knotenpunkt2]/
      SCT/
    Druckprufung/
      [Knotenpunkt1]/
      [Knotenpunkt2]/
    Einblasen/
      BB/
      HA/
      [Knotenpunkt1]/
      [Knotenpunkt2]/
    kalibrieren/
      [Knotenpunkt1]/
      [Knotenpunkt2]/
    Knotenpunkt_Vorbereitung/
      [Knotenpunkt1]/
      [Knotenpunkt2]/
    OTDR/
      [Knotenpunkt1]/
      [Knotenpunkt2]/
      SCT/
    POP_details/
    SCT_details/
Pläne/
  [ClusterName]/
```
