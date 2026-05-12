# Splicing Module

**Part of:** Knotenpunkt Vorbereitung page (`knotenpunkt-vorbereitung.html`)  
**File:** `src/js/knotenpunkt-vorbereitung.js`  
**ACL Key:** `knotenpunkt`

---

## Overview

Splicing is the per-address sub-section of the Knotenpunkt Vorbereitung module. It is not a standalone page or class — it's the address-level workflow within `knotenpunkt-vorbereitung.html`.

For each address in a Knotenpunkt, the technician uploads a photo of the completed splices. This sets `knotenpunkt status = Done` in the Aufmass, which (combined with APL Done) automatically unlocks the OTDR module for that address.

See [knotenpunkt-vorbereitung.md](knotenpunkt-vorbereitung.md) for the full module documentation including NVT preparation.

---

## What Splicing Does

1. Navigate: Cluster → Knotenpunkt → Address list
2. Select address → upload splice photo
3. Aufmass updated: `knotenpunkt status → Done`, `knotenpunkt image location → path`
4. If `apl status` is already `Done` for that address → OTDR status auto-set to `"Waiting"`

---

## File Naming

```
{Knotenpunkt}_{AddrClean}_Splices_{YYYYMMDD_HHmmss}.{ext}
```

---

## Storage Path

```
STORAGE_ROOT/<project>/Doku/<Cluster>/Knotenpunkt_Vorbereitung/<Knotenpunkt>/
```

No address subfolder — all splice images go into the same Knotenpunkt folder.

---

## Aufmass Columns

Group `splicing`:

| Column | Value |
|---|---|
| `knotenpunkt status` | `"Done"` |
| `knotenpunkt image location` | Path to uploaded file |

---

## OTDR Unlock Flow

```
Splicing upload for address A
    → knotenpunkt status = "Done"
    → server checks APL status for same row
    → if APL status = "Done" → OTDR status = "Waiting"
```

This server-side check is in `routes/moduleRoutes.js` inside the `aufmass-update` handler (`otdrAutoTriggered` logic).
