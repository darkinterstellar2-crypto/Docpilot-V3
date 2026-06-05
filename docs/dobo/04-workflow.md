# DocPilot User Workflows — DoBo Reference

## Daily Workflow for a Field Technician

### Morning
1. Log in → Land on Dashboard (index.html)
2. Click assigned project
3. Open Planner to see today's appointments
4. Check Aufmass for pending addresses in their cluster

### On Site
1. Navigate to the relevant module (e.g., Einblasen)
2. Drill down: Cluster → Knotenpunkt → Address
3. Upload PDF or photos
4. Mark status Done (or Error if problems)
5. Take notes if needed

### End of Day
1. Check Aufmass for any missed items
2. Review error statuses, note issues
3. Log out (auto-logout after 30min idle)

---

## Module Workflow Examples

### Example: Completing "Einblasen" for an Address
1. Go to einblasen.html
2. Select cluster → select KVz → find address "Musterstr. 5"
3. Upload "Einblasprotokoll.pdf"
4. Click "Mark Done"
5. Status turns green ✅

### Example: Completing APL
1. Go to apl.html → navigate to address
2. Upload 4 photos (Außenansicht, Innenansicht, Kabelablage, Etikett)
3. Schedule appointment if needed
4. When all 4 photos uploaded + appointment done → mark Done
5. This UNLOCKS the OTDR module for this address

### Example: OTDR blocked?
- OTDR tab is grayed out? → APL and/or Splicing not yet Done
- Check APL status for that address → if "waiting", complete it first
- Check Knotenpunkt status → if pending, do splicing first

---

## Common User Problems & DoBo Answers

### "I can't open the OTDR module"
→ OTDR requires APL AND Knotenpunkt/Splicing to be "Done" first. Check those modules for the address.

### "I uploaded the file but status didn't change"
→ Status only changes when explicitly clicked. Upload ≠ auto-done. Click the "Mark Done" button after uploading.

### "I can't find my project"
→ Your project access may not be configured. Ask your admin to assign you to the project.

### "I accidentally uploaded the wrong file"
→ Go to the module, find the address, delete the incorrect file, re-upload. Or use the Files module to manage files directly.

### "The app logged me out"
→ DocPilot has 30-minute auto-logout for security. Log back in — your data is saved.

### "I need to give access to a new colleague"
→ They need to register at /register.html, then an admin must approve them in admin.html.

---

## Admin Workflows

### Approving a New User
1. Go to admin.html
2. See "Pending Users" section
3. Click Approve (sends welcome email)

### Setting Project Access
1. admin.html → User Management
2. Find user → Edit permissions
3. Assign projects + modules

### Viewing Audit Logs
1. admin.html → Session Logs tab
2. See login/logout history for all users

### Super Logs (superadmin only)
1. superlog.html
2. Full system event log

---

## Project Manager Workflows

### Creating a New Project
1. index.html → New Project button
2. Fill in project name, description
3. Upload Aufmass CSV/Excel to populate addresses

### Monitoring Progress
1. Open Aufmass for the project
2. Use status filters (Done/Pending/Error)
3. Export to Excel for reporting

### Calendar Overview
1. calendar.html
2. See all appointments from all modules
3. Filter by module type (APL, Knotenpunkt, etc.)
