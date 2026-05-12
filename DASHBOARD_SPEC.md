# Dashboard Modules Specification

## Dashboard Cards (each links to a dedicated HTML page):
1. Aufmass (existing) → aufmass.html
2. Druckprufung → druckprufung.html
3. Einblasen → einblasen.html
4. Kalibrieren → kalibrieren.html
5. APL → apl.html
6. NVT &amp; Splicing (merged) → knotenpunkt-vorbereitung.html
8. OTDR → otdr.html
9. Files (existing) → files.html

## Navigation Pattern (for modules 2-8):
Project → Cluster → Knotenpunkt → Address (from aufmass data) → Upload

## Schema Change:
"APL Splicing" → "Splicing" with sub-columns:
- APL status
- Knotenpunkt Status
- number of splices
- APL folder location
- Knotenpunkt image location

"LWL count" in Einblasen → "Metrierung total"

## Module Details:

### 1. Druckprufung
- Navigate: Cluster → Knotenpunkt → Address
- Upload: 1 PDF file per address
- Dropdown: type (12x10, 4x20, custom)
- Save to: Doku/[Cluster]/Druckprufung/[Address PDF]
- No address subfolder needed (1 file per address)
- Auto-update aufmass: status → Done, type → selected, file location → path

### 2. Einblasen
- Same flow as Druckprufung
- Additionally asks for "total Metrierung" (number)
- Writes to: Metrierung total column AND copies to LWL Specs Total
- Column rename: "LWL count" → "Metrierung total"
- Save to: Doku/[Cluster]/Einblasen/[Address PDF]

### 3. Kalibrieren
- Same as Druckprufung
- Save to: Doku/[Cluster]/kalibrieren/[Address PDF]

### 4. APL
- Navigate: Cluster → Knotenpunkt → Address
- Asks for number of splices first
- Upload 4 required images:
  1. Metrierung image
  2. APL box image
  3. Splices image
  4. Inside APL image
- Option to upload extra images
- Creates address subfolder ONLY when uploading
- Name convention: Knotenpunkt_Address_(image type)_date&time
- Save to: Doku/[Cluster]/APL/[Knotenpunkt]/[Address]/
- Auto-update: APL status → Done, number of splices → entered value, APL folder location → path

### 5. Splicing (Knotenpunkt_Splices)
- Navigate: Cluster → Knotenpunkt → Address (select from list)
- Upload: splice image per address
- No address subfolder — saves in Knotenpunkt_Vorbereitung/[Knotenpunkt]/
- Name convention: Knotenpunkt_Address_Splices_date&time
- Auto-update: Knotenpunkt Status → Done, Knotenpunkt image location → path

### 6. Knotenpunkt_Vorbereitung
- Navigate: Cluster → Knotenpunkt (no address needed)
- Upload: multiple images
- Save to: Doku/[Cluster]/Knotenpunkt_Vorbereitung/[Knotenpunkt]/

### 7. OTDR
- Auto-trigger: when APL status AND Knotenpunkt Status both → Done, OTDR status → Waiting
- Navigate: Cluster → Knotenpunkt → Address
- Upload: (number_of_splices × 4) files per address: 1 PDF + 3 SOR per splice
- If file count doesn't match: warning "Incomplete OTDR" but allow upload, status → Incomplete (red)
- If address already has files: offer "Replace" or "Add"
- Don't rename files — keep original names
- Creates address subfolder: Doku/[Cluster]/OTDR/[Knotenpunkt]/[Address]/
- When all files present → status → Done
- Auto-update: OTDR status, type (from splice count), folder location

## Implementation Plan (8 steps):
1. Schema changes (APL Splicing → Splicing, LWL count → Metrierung total) + update data file
2. Shared backend: upload routes, aufmass auto-update API, navigation helpers
3. Shared frontend: cluster→knotenpunkt→address navigation component, glassmorphism pages
4. Dashboard.html: add all module cards
5. Druckprufung + Einblasen + Kalibrieren (similar flow)
6. APL module
7. Splicing + Knotenpunkt_Vorbereitung modules
8. OTDR module (complex: auto-status, file counting, incomplete handling)
