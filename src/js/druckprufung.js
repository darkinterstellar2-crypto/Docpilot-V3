/**
 * druckprufung.js
 * Instantiates ModuleNavigator for the Druckprüfung module.
 */

(function () {
    const urlParams   = new URLSearchParams(window.location.search);
    const projectName = urlParams.get('project');
    const userRole    = localStorage.getItem('userRole');

    // Auth guard
    if (!projectName) { window.location.href = 'index.html'; return; }
    if (!userRole)    { window.location.href = 'login.html'; return; }
    // Access is controlled by backend ACL — no client-side role redirect

    // Update header project name
    const displayEl = document.getElementById('projectNameDisplay');
    if (displayEl) displayEl.textContent = projectName;

    // Back button → project dashboard
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.onclick = () => window.location.href = `dashboard.html?project=${encodeURIComponent(projectName)}`;

    // Boot navigator
    const nav = new ModuleNavigator({
        project:       projectName,
        moduleName:    'Druckprüfung',
        moduleKey:     'druckprufung',
        targetFolder:  'Druckprufung',
        // Used to locate the right column group in the schema.
        // Matches a group whose label contains "druckprufung" (case-insensitive).
        groupLabel:    'druckprufung',
        typeOptions:   ['12x10', '4x20', 'custom'],
        useOriginalFilename: true,
        containers: {
            content:    document.getElementById('moduleContent'),
            breadcrumb: document.getElementById('moduleBreadcrumb'),
        }
    });

    nav.init().catch(err => console.error('Druckprüfung init error:', err));
})();
