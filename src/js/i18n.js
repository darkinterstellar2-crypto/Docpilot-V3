/**
 * i18n.js — Simple English/German language toggle.
 * 
 * Usage: Add data-i18n="key" to any element. Text will be replaced on load.
 * Language stored in localStorage('lang') — defaults to 'en'.
 * Include this script on every page, before </body>.
 */

const I18N = {
    _lang: localStorage.getItem('lang') || 'en',

    translations: {
        // ── Navigation / Header ─────────────────────────────────────
        'nav.hub': { en: 'Hub', de: 'Hub' },
        'nav.admin': { en: 'Admin', de: 'Admin' },
        'nav.profile': { en: 'Profile', de: 'Profil' },
        'nav.back': { en: 'Back', de: 'Zurück' },

        // ── Hub / Index ─────────────────────────────────────────────
        'hub.projects': { en: 'Projects', de: 'Projekte' },
        'hub.newProject': { en: 'New Project', de: 'Neues Projekt' },
        'hub.openDashboard': { en: 'Open Dashboard', de: 'Dashboard öffnen' },
        'hub.rows': { en: 'rows', de: 'Zeilen' },
        'hub.noProjects': { en: 'No projects yet', de: 'Noch keine Projekte' },

        // ── Dashboard ───────────────────────────────────────────────
        'dash.title': { en: 'Dashboard', de: 'Dashboard' },
        'dash.modules': { en: 'Modules', de: 'Module' },
        'dash.aufmass': { en: 'Aufmass', de: 'Aufmass' },
        'dash.files': { en: 'Files', de: 'Dateien' },
        'dash.druckprufung': { en: 'Pressure Test', de: 'Druckprüfung' },
        'dash.kalibrieren': { en: 'Calibration', de: 'Kalibrieren' },
        'dash.einblasen': { en: 'Fiber Blowing', de: 'Einblasen' },
        'dash.apl': { en: 'APL', de: 'APL' },
        'dash.splicing': { en: 'Splicing', de: 'Spleißen' },
        'dash.knotenpunkt': { en: 'Junction Prep', de: 'Knotenpunkt Vorbereitung' },
        'dash.otdr': { en: 'OTDR', de: 'OTDR' },
        'dash.aufmassDesc': { en: 'Measurement & surveying documentation matrix.', de: 'Aufmaß- und Vermessungsdokumentation.' },
        'dash.einblasenDesc': { en: 'Fiber blowing status, cable logs and LWL counts.', de: 'Einblasstatus, Kabellogs und LWL-Zählung.' },
        'dash.druckprufungDesc': { en: 'Pressure testing protocols and verification.', de: 'Druckprüfungsprotokolle und Verifizierung.' },
        'dash.aplDesc': { en: 'Abschlusspunkt Linientechnik tracking & audit.', de: 'APL-Verfolgung und Prüfung.' },
        'dash.otdrDesc': { en: 'Optical Time-Domain Reflectometer test results.', de: 'OTDR-Messprotokoll-Ergebnisse.' },
        'dash.kalibrierenDesc': { en: 'Calibration logs and system adjustments.', de: 'Kalibrierungsprotokolle und Systemanpassungen.' },
        'dash.splicingDesc': { en: 'Fiber splice records, APL connections and joint logs.', de: 'Spleißprotokolle, APL-Verbindungen und Muffenlogs.' },
        'dash.knotenpunktDesc': { en: 'Node preparation checklists and site readiness.', de: 'Knotenpunkt-Vorbereitung und Standortbereitschaft.' },
        'dash.filesDesc': { en: 'Project file storage, upload and download documents.', de: 'Projektspeicher, Dokumente hoch- und herunterladen.' },

        // ── Auth ────────────────────────────────────────────────────
        'auth.login': { en: 'Login', de: 'Anmelden' },
        'auth.register': { en: 'Register', de: 'Registrieren' },
        'auth.logout': { en: 'Logout', de: 'Abmelden' },
        'auth.email': { en: 'Email', de: 'E-Mail' },
        'auth.password': { en: 'Password', de: 'Passwort' },
        'auth.username': { en: 'Username', de: 'Benutzername' },
        'auth.fullName': { en: 'Full Name', de: 'Vollständiger Name' },
        'auth.signIn': { en: 'Sign In', de: 'Anmelden' },
        'auth.signUp': { en: 'Sign Up', de: 'Registrieren' },
        'auth.noAccount': { en: "Don't have an account?", de: 'Noch kein Konto?' },
        'auth.hasAccount': { en: 'Already have an account?', de: 'Bereits ein Konto?' },
        'auth.verifyEmail': { en: 'Verify Email', de: 'E-Mail bestätigen' },
        'auth.enterOtp': { en: 'Enter verification code', de: 'Bestätigungscode eingeben' },
        'auth.verify': { en: 'Verify', de: 'Bestätigen' },
        'auth.usernameOrEmail': { en: 'Username or Email', de: 'Benutzername oder E-Mail' },

        // ── Profile ─────────────────────────────────────────────────
        'profile.title': { en: 'Profile', de: 'Profil' },
        'profile.personalInfo': { en: 'Personal Information', de: 'Persönliche Informationen' },
        'profile.changePassword': { en: 'Change Password', de: 'Passwort ändern' },
        'profile.currentPassword': { en: 'Current Password', de: 'Aktuelles Passwort' },
        'profile.newPassword': { en: 'New Password', de: 'Neues Passwort' },
        'profile.confirmPassword': { en: 'Confirm New Password', de: 'Neues Passwort bestätigen' },
        'profile.save': { en: 'Save Changes', de: 'Änderungen speichern' },
        'profile.edit': { en: 'Edit', de: 'Bearbeiten' },
        'profile.cancel': { en: 'Cancel', de: 'Abbrechen' },
        'profile.removePhoto': { en: 'Remove photo', de: 'Foto entfernen' },
        'profile.memberSince': { en: 'Member Since', de: 'Mitglied seit' },
        'profile.signOut': { en: 'Sign Out', de: 'Abmelden' },
        'profile.signOutDesc': { en: 'Log out of your DocPilot account', de: 'Aus DocPilot-Konto abmelden' },

        // ── Files ───────────────────────────────────────────────────
        'files.title': { en: 'Files', de: 'Dateien' },
        'files.upload': { en: 'Upload', de: 'Hochladen' },
        'files.newFolder': { en: 'New Folder', de: 'Neuer Ordner' },
        'files.delete': { en: 'Delete', de: 'Löschen' },
        'files.rename': { en: 'Rename', de: 'Umbenennen' },
        'files.download': { en: 'Download', de: 'Herunterladen' },
        'files.copy': { en: 'Copy', de: 'Kopieren' },
        'files.move': { en: 'Move', de: 'Verschieben' },
        'files.share': { en: 'Share', de: 'Teilen' },
        'files.trash': { en: 'Trash', de: 'Papierkorb' },
        'files.restore': { en: 'Restore', de: 'Wiederherstellen' },
        'files.emptyTrash': { en: 'Empty Trash', de: 'Papierkorb leeren' },
        'files.root': { en: 'Root', de: 'Stammverzeichnis' },
        'files.noFiles': { en: 'This folder is empty', de: 'Dieser Ordner ist leer' },
        'files.dropHere': { en: 'Drop files here to upload', de: 'Dateien zum Hochladen hierher ziehen' },

        // ── Aufmass / Table ─────────────────────────────────────────
        'table.save': { en: 'Save', de: 'Speichern' },
        'table.discard': { en: 'Discard', de: 'Verwerfen' },
        'table.addRow': { en: 'Add Row', de: 'Zeile hinzufügen' },
        'table.search': { en: 'Search...', de: 'Suchen...' },
        'table.export': { en: 'Export Excel', de: 'Excel exportieren' },
        'table.editMode': { en: 'Edit Mode', de: 'Bearbeitungsmodus' },
        'table.viewMode': { en: 'View Mode', de: 'Ansichtsmodus' },

        // ── Modules (shared) ────────────────────────────────────────
        'mod.done': { en: 'Done', de: 'Erledigt' },
        'mod.pending': { en: 'Pending', de: 'Ausstehend' },
        'mod.waiting': { en: 'Waiting', de: 'Wartend' },
        'mod.incomplete': { en: 'Incomplete', de: 'Unvollständig' },
        'mod.upload': { en: 'Upload', de: 'Hochladen' },
        'mod.uploadAll': { en: 'Upload All', de: 'Alle hochladen' },
        'mod.noAddresses': { en: 'No addresses found.', de: 'Keine Adressen gefunden.' },
        'mod.markAppointment': { en: 'Mark Appointment', de: 'Termin eintragen' },
        'mod.editAppointment': { en: 'Edit Appointment', de: 'Termin bearbeiten' },
        'mod.uploadWork': { en: 'Upload Work', de: 'Arbeit hochladen' },
        'mod.scheduleDesc': { en: 'Schedule a date & time', de: 'Datum & Uhrzeit planen' },
        'mod.uploadDesc': { en: 'Upload files for this address', de: 'Dateien für diese Adresse hochladen' },
        'mod.workDone': { en: 'Work already uploaded', de: 'Arbeit bereits hochgeladen' },
        'mod.appointment': { en: 'Appointment', de: 'Termin' },
        'mod.upcoming': { en: 'Upcoming', de: 'Bevorstehend' },
        'mod.overdue': { en: 'Overdue', de: 'Überfällig' },
        'mod.saveAppointment': { en: 'Save Appointment', de: 'Termin speichern' },
        'mod.removeAppointment': { en: 'Remove Appointment', de: 'Termin entfernen' },
        'mod.date': { en: 'Date', de: 'Datum' },
        'mod.time': { en: 'Time', de: 'Uhrzeit' },
        'mod.notes': { en: 'Notes', de: 'Notizen' },
        'mod.back': { en: 'Back', de: 'Zurück' },

        // ── Admin ───────────────────────────────────────────────────
        'admin.title': { en: 'Admin Panel', de: 'Verwaltung' },
        'admin.users': { en: 'Users', de: 'Benutzer' },
        'admin.approve': { en: 'Approve', de: 'Genehmigen' },
        'admin.reject': { en: 'Reject', de: 'Ablehnen' },
        'admin.delete': { en: 'Delete', de: 'Löschen' },
        'admin.permissions': { en: 'Permissions', de: 'Berechtigungen' },
        'admin.auditLog': { en: 'Audit Log', de: 'Protokoll' },

        // ── New Project ─────────────────────────────────────────────
        'newProject.title': { en: 'New Project', de: 'Neues Projekt' },
        'newProject.name': { en: 'Project Name', de: 'Projektname' },
        'newProject.create': { en: 'Create Project', de: 'Projekt erstellen' },
        'newProject.uploadData': { en: 'Upload Aufmass Data', de: 'Aufmass-Daten hochladen' },

        // ── Common ──────────────────────────────────────────────────
        'common.loading': { en: 'Loading...', de: 'Laden...' },
        'common.error': { en: 'Error', de: 'Fehler' },
        'common.success': { en: 'Success', de: 'Erfolg' },
        'common.confirm': { en: 'Confirm', de: 'Bestätigen' },
        'common.cancel': { en: 'Cancel', de: 'Abbrechen' },
        'common.close': { en: 'Close', de: 'Schließen' },
        'common.yes': { en: 'Yes', de: 'Ja' },
        'common.no': { en: 'No', de: 'Nein' },
        'common.optional': { en: 'optional', de: 'optional' },
        'common.required': { en: 'required', de: 'erforderlich' },
    },

    /** Get current language */
    lang() { return this._lang; },

    /** Set language and re-apply */
    setLang(lang) {
        this._lang = lang;
        localStorage.setItem('lang', lang);
        this.apply();
        // Update toggle button
        const btn = document.getElementById('langToggle');
        if (btn) btn.textContent = lang === 'de' ? 'DE' : 'EN';
    },

    /** Translate a key */
    t(key) {
        const entry = this.translations[key];
        if (!entry) return key;
        return entry[this._lang] || entry['en'] || key;
    },

    /** Apply translations to all data-i18n elements */
    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.getAttribute('data-i18n-attr') === 'placeholder') {
                    el.placeholder = text;
                } else {
                    el.value = text;
                }
            } else {
                el.textContent = text;
            }
        });
        // Also handle data-i18n-placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
        });
        // Handle data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.getAttribute('data-i18n-title'));
        });
    },

    /** Inject the language toggle button into the header */
    injectToggle() {
        const header = document.querySelector('header .flex.items-center.gap-2') 
                     || document.querySelector('header');
        if (!header) return;

        // Check if toggle already exists
        if (document.getElementById('langToggle')) return;

        const btn = document.createElement('button');
        btn.id = 'langToggle';
        btn.className = 'px-2 py-1 text-xs font-bold rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors';
        btn.textContent = this._lang === 'de' ? 'DE' : 'EN';
        btn.title = 'Switch language / Sprache wechseln';
        btn.addEventListener('click', () => {
            this.setLang(this._lang === 'en' ? 'de' : 'en');
        });

        // Insert before the first button or at the start
        const firstChild = header.querySelector('button, a, .w-px');
        if (firstChild) {
            header.insertBefore(btn, firstChild);
        } else {
            header.appendChild(btn);
        }
    },

    /** Init: apply translations + inject toggle */
    init() {
        this.apply();
        this.injectToggle();
    }
};

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => I18N.init());
} else {
    I18N.init();
}
