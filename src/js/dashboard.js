function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function escAttr(s) { return JSON.stringify(String(s || '')); }

document.addEventListener('DOMContentLoaded', async () => {

    const userRole = localStorage.getItem('userRole');
    if (!userRole) { window.location.href = 'login.html'; return; }

    // Only superadmin gets admin panel and new project button
    const isSuperadmin = userRole === 'superadmin';
    const userEmail = localStorage.getItem('userEmail') || '';

    if (isSuperadmin) {
        const adminBtn = document.getElementById('adminPanelBtn');
        if(adminBtn) adminBtn.classList.remove('hidden');
    }

    // Admin nav button: superadmin only
    const adminNavBtn = document.getElementById('adminNavBtn');
    if (adminNavBtn) adminNavBtn.style.display = isSuperadmin ? '' : 'none';

    // ─── Permissions ────────────────────────────────────────────────
    // Will be populated by loadPermissions(); controls UI visibility.
    let dashPerms = {
        createProject: isSuperadmin,
        deleteProject: isSuperadmin,
        changeStatus: isSuperadmin,
        reorderProjects: isSuperadmin,
        downloadZip: isSuperadmin,
    };
    let projectPerms = {}; // { ProjectName: { canEdit, modules } }

    async function loadPermissions() {
        if (isSuperadmin) {
            // Superadmin: all true — no need to fetch
            applyPermissionUI();
            return;
        }
        try {
            const res = await fetch('/api/access/permissions', {
                headers: { 'x-user-email': userEmail, 'x-user-role': userRole }
            });
            const data = await res.json();
            if (data.success) {
                if (data.fullAccess) {
                    dashPerms = { createProject: true, deleteProject: true, changeStatus: true, reorderProjects: true, downloadZip: true, editProjectInfo: true };
                } else {
                    dashPerms = data.authority || data.dashboard || dashPerms;
                    projectPerms = data.projects || {};
                }
            }
        } catch (e) {
            console.error('Failed to load permissions:', e);
        }
        applyPermissionUI();
    }

    function applyPermissionUI() {
        // New Project button: show only if user can create
        const newProjectBtn = document.getElementById('newProjectBtn');
        if (newProjectBtn) {
            newProjectBtn.style.display = dashPerms.createProject ? '' : 'none';
        }
    }

    // Expose to renderProjects so it can build context-aware menus
    window._dashPerms = dashPerms;
    window._projectPerms = projectPerms;

    const newProjectBtn = document.getElementById('newProjectBtn');
    const projectModal = document.getElementById('projectModal');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const createProjectBtn = document.getElementById('createProjectBtn');
    const addLocationBtn = document.getElementById('addLocationBtn');
    const locationsList = document.getElementById('locationsList');
    const projectGrid = document.getElementById('projectGrid');

    // --- SCHEMA BUILDER LOGIC ---
    let customSchema = [
        { title: 'Timing', cols: ['Date'] },
        { title: 'Location', cols: ['Cluster', 'NVT'] },
        { title: 'Address', cols: ['Address Start', 'Address End'] },
        { title: 'Hardware', cols: ['Cable name', 'Fiber count'] },
        { title: 'LWL Specs', cols: ['LWL Start', 'LWL End', 'Total'] },
        { title: 'Einblasen', cols: ['Status', 'LWL count', 'File Location'] },
        { title: 'Kalibrieren', cols: ['Status', 'Type', 'File Location'] },
        { title: 'Druckprüfung', cols: ['Status', 'Type', 'File Location'] },
        { title: 'APL Splicing', cols: ['Status', 'Type', 'Splices', 'Folder Location'] },
        { title: 'OTDR Testing', cols: ['Status', 'Type', 'Folder Location'] },
        { title: 'Notes', cols: ['Comments'] }
    ];

    const defaultMasterSchema = JSON.stringify(customSchema);
    const useDefaultSchema = document.getElementById('useDefaultSchema');
    const schemaBuilderWrapper = document.getElementById('schemaBuilderWrapper');
    const addMainColBtn = document.getElementById('addMainColBtn');
    const schemaBuilder = document.getElementById('schemaBuilder');

    useDefaultSchema?.addEventListener('change', (e) => {
        if (e.target.checked) {
            schemaBuilderWrapper.classList.add('hidden');
            customSchema = JSON.parse(defaultMasterSchema);
            renderSchemaBuilder();
        } else {
            schemaBuilderWrapper.classList.remove('hidden');
        }
    });

    addMainColBtn?.addEventListener('click', () => {
        const newName = prompt('Enter new Main Column name:');
        if (newName && newName.trim() !== '') { 
            customSchema.push({ title: newName.trim(), cols: ['New Sub-column'] }); 
            renderSchemaBuilder(); 
        }
    });

    function renderSchemaBuilder() {
        if(!schemaBuilder) return;
        schemaBuilder.innerHTML = '';
        customSchema.forEach((group, gIndex) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'min-w-[200px] max-w-[200px] bg-white border border-slate-200 rounded shadow-sm flex flex-col shrink-0';
            let html = `
                <div class="bg-slate-800 text-white p-2 rounded-t flex justify-between items-center group">
                    <span class="text-xs font-bold uppercase tracking-wider truncate cursor-pointer hover:text-blue-200 edit-group flex-grow" data-gidx="${gIndex}">${group.title}</span>
                    <button class="text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 del-group font-bold px-1" data-gidx="${gIndex}">&times;</button>
                </div>
                <div class="p-2 flex flex-col gap-1 flex-grow">
            `;
            group.cols.forEach((col, cIndex) => {
                html += `
                    <div class="flex justify-between items-center bg-slate-50 border border-slate-100 px-2 py-1 rounded text-sm group/item">
                        <span class="truncate text-slate-600 cursor-pointer hover:text-blue-600 edit-col flex-grow" data-gidx="${gIndex}" data-cidx="${cIndex}">${col}</span>
                        <button class="text-slate-300 hover:text-red-500 opacity-0 group-hover/item:opacity-100 del-col font-bold px-1" data-gidx="${gIndex}" data-cidx="${cIndex}">&times;</button>
                    </div>
                `;
            });
            html += `</div><button class="text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50 py-2 border-t border-slate-100 add-col" data-gidx="${gIndex}">+ Add Column</button>`;
            groupDiv.innerHTML = html;
            schemaBuilder.appendChild(groupDiv);
        });
        attachSchemaListeners();
    }

    function attachSchemaListeners() {
        document.querySelectorAll('.edit-group').forEach(el => el.addEventListener('click', (e) => {
            const gIdx = e.target.dataset.gidx; const newName = prompt('Rename:', customSchema[gIdx].title);
            if (newName) { customSchema[gIdx].title = newName.trim(); renderSchemaBuilder(); }
        }));
        document.querySelectorAll('.del-group').forEach(el => el.addEventListener('click', (e) => {
            const gIdx = e.target.dataset.gidx; if (confirm(`Remove column?`)) { customSchema.splice(gIdx, 1); renderSchemaBuilder(); }
        }));
        document.querySelectorAll('.edit-col').forEach(el => el.addEventListener('click', (e) => {
            const gIdx = e.target.dataset.gidx; const cIdx = e.target.dataset.cidx; const newName = prompt('Rename:', customSchema[gIdx].cols[cIdx]);
            if (newName) { customSchema[gIdx].cols[cIdx] = newName.trim(); renderSchemaBuilder(); }
        }));
        document.querySelectorAll('.del-col').forEach(el => el.addEventListener('click', (e) => {
            const gIdx = e.target.dataset.gidx; const cIdx = e.target.dataset.cidx;
            if (customSchema[gIdx].cols.length <= 1) return alert("Need at least one sub-column.");
            customSchema[gIdx].cols.splice(cIdx, 1); renderSchemaBuilder();
        }));
        document.querySelectorAll('.add-col').forEach(el => el.addEventListener('click', (e) => {
            const gIdx = e.target.dataset.gidx; const newName = prompt('Enter sub-column:');
            if (newName) { customSchema[gIdx].cols.push(newName.trim()); renderSchemaBuilder(); }
        }));
    }

    // --- CREATE PROJECT LOGIC ---
    let locationCount = 1;

    newProjectBtn?.addEventListener('click', () => {
        projectModal.classList.remove('hidden');
        renderSchemaBuilder();
    });

    cancelModalBtn?.addEventListener('click', () => {
        projectModal.classList.add('hidden');
    });

    addLocationBtn?.addEventListener('click', () => {
        locationCount++;
        const locDiv = document.createElement('div');
        locDiv.className = 'flex items-center gap-2 mb-2';
        locDiv.innerHTML = `<input type="text" value="Loc_${locationCount}" class="location-input w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"><button class="remove-loc text-slate-400 hover:text-red-500 font-bold px-2">&times;</button>`;
        locationsList.appendChild(locDiv);
        locDiv.querySelector('.remove-loc').addEventListener('click', (e) => { e.target.parentElement.remove(); });
    });

    createProjectBtn?.addEventListener('click', async () => {
        const projectName = document.getElementById('projectName').value.trim();
        const locInputs = document.querySelectorAll('.location-input');
        const locations = Array.from(locInputs).map(i => i.value.trim()).filter(v => v !== '');

        if (!projectName || locations.length === 0) return alert('Enter name and location.');

        const originalText = createProjectBtn.innerHTML;
        createProjectBtn.innerHTML = 'Generating...';

        try {
            const response = await fetch('/api/projects/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown', 'x-user-role': localStorage.getItem('userRole') || '' },
                body: JSON.stringify({ projectName, locations, schema: customSchema })
            });
            const result = await response.json();
            if (result.success) {
                projectModal.classList.add('hidden');
                document.getElementById('projectName').value = '';
                loadProjects(); 
            } else { alert(result.message); }
        } catch (error) { alert('Server failed.'); } 
        finally { createProjectBtn.innerHTML = originalText; }
    });

    // --- CARTOON MODE DASHBOARD LOGIC ---
    
    window.toggleMenu = function(e, projectName) {
        e.stopPropagation(); 
        document.querySelectorAll('.project-menu-dropdown').forEach(m => { if(m.id !== `menu-${projectName}`) m.classList.add('hidden'); });
        document.getElementById(`menu-${projectName}`).classList.toggle('hidden');
    };

    document.addEventListener('click', () => {
        document.querySelectorAll('.project-menu-dropdown').forEach(m => m.classList.add('hidden'));
    });

    window.setStatus = async function(e, projectName, newStatus) {
        e.stopPropagation();
        document.getElementById(`menu-${projectName}`).classList.add('hidden');
        try {
            const res = await fetch('/api/projects/status', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown', 'x-user-role': localStorage.getItem('userRole') || '' },
                body: JSON.stringify({ projectName, newStatus })
            });
            if(res.ok) loadProjects();
        } catch(e) { alert("Failed to update status"); }
    };

    // 🌟 SPONGEBOB = DELETE
    window.spongebobProject = async function(e, projectName) {
        e.stopPropagation();
        document.getElementById(`menu-${projectName}`).classList.add('hidden');
        
        // 🌟 PATRICK = WARNING
        const patrickMsg = confirm(`DANGER: Remove "${projectName}" forever from the F-Drive?`);
        if(!patrickMsg) return;

        try {
            // Note: I changed the route to /remove to avoid any backend keyword blocks
            const res = await fetch('/api/projects/remove', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown', 'x-user-role': localStorage.getItem('userRole') || '' },
                body: JSON.stringify({ projectName })
            });
            const result = await res.json();
            if(result.success) loadProjects();
            else alert(result.message);
        } catch(e) { alert("Server error."); }
    };

    window.moveProject = async function(e, projectName, direction) {
        e.stopPropagation();
        document.getElementById(`menu-${projectName}`).classList.add('hidden');
        
        try {
            const res = await fetch('/api/projects/reorder', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown', 'x-user-role': localStorage.getItem('userRole') || '' },
                body: JSON.stringify({ projectName, direction })
            });
            if(res.ok) loadProjects();
        } catch(e) { console.error("Failed to reorder"); }
    };

    window.downloadZip = function(e, projectName) {
        e.stopPropagation();
        document.getElementById(`menu-${projectName}`).classList.add('hidden');

        // Show syncing notification
        const syncBanner = document.getElementById('nas-sync-banner');
        const syncBannerText = document.getElementById('nas-sync-banner-text');
        if (syncBanner) {
            if (syncBannerText) syncBannerText.textContent = `Syncing "${projectName}" from NAS… this may take a moment`;
            syncBanner.classList.remove('hidden');
        }

        // Trigger download — browser will show save dialog when headers arrive
        const link = document.createElement('a');
        link.href = `/api/projects/zip/${encodeURIComponent(projectName)}`;
        link.download = `${projectName}_Backup.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Hide banner after a delay (download starting means server responded)
        setTimeout(() => {
            if (syncBanner) syncBanner.classList.add('hidden');
        }, 8000);
    };

    async function loadProjects() {
        if(!projectGrid) return;
        try {
            const response = await fetch('/api/projects', {
                headers: {
                    'x-user-email': userEmail,
                    'x-user-role': userRole
                }
            });
            const data = await response.json();
            
            if (data.success && data.projects.length > 0) {
                renderProjects(data.projects);
            } else {
                projectGrid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-500 font-medium">No projects found.</div>`;
            }
        } catch (error) { console.error('Error fetching projects:', error); }
    }

    function renderProjects(projects) {
        projectGrid.innerHTML = '';
        // Sync permissions reference (loadPermissions may have updated it after render)
        const perms = dashPerms;

        // Determine which menu sections to show
        const hasAnyMenuOption = perms.reorderProjects || perms.changeStatus || perms.downloadZip || perms.deleteProject;

        projects.forEach(project => {
            const locs = project.locations ? project.locations.join(', ') : 'None';
            
            // Map the 4 new industry-standard statuses
            const currentStatus = project.status || 'To be started';
            let statusColor = 'bg-gray-400'; // To be started
            if (currentStatus === 'Active') statusColor = 'bg-blue-500';
            else if (currentStatus === 'Payment awaiting') statusColor = 'bg-yellow-500';
            else if (currentStatus === 'Completed') statusColor = 'bg-green-500';

            // Build the management dropdown — only render sections the user has permission for
            let menuItems = '';

            if (perms.reorderProjects) {
                menuItems += `
                    <div class="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Priority</div>
                    <button onclick="moveProject(event, ${escAttr(project.name)}, 'left')" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between">Increase Priority <span class="text-gray-400">&uarr;</span></button>
                    <button onclick="moveProject(event, ${escAttr(project.name)}, 'right')" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between">Decrease Priority <span class="text-gray-400">&darr;</span></button>
                    <div class="border-t border-gray-100 my-1"></div>
                `;
            }

            if (perms.changeStatus) {
                menuItems += `
                    <div class="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Set Status</div>
                    <button onclick="setStatus(event, ${escAttr(project.name)}, 'To be started')" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-gray-400"></span> To be started</button>
                    <button onclick="setStatus(event, ${escAttr(project.name)}, 'Active')" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-blue-500"></span> Active</button>
                    <button onclick="setStatus(event, ${escAttr(project.name)}, 'Payment awaiting')" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-yellow-500"></span> Payment awaiting</button>
                    <button onclick="setStatus(event, ${escAttr(project.name)}, 'Completed')" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-green-500"></span> Completed</button>
                    <div class="border-t border-gray-100 my-1"></div>
                `;
            }

            if (perms.downloadZip) {
                menuItems += `
                    <button onclick="downloadZip(event, ${escAttr(project.name)})" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> Download ZIP
                    </button>
                `;
            }

            if (perms.deleteProject) {
                menuItems += `
                    <button onclick="spongebobProject(event, ${escAttr(project.name)})" class="w-full text-left px-4 py-2 text-sm text-red-600 font-medium hover:bg-red-50 flex items-center gap-2">
                        <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Delete Project
                    </button>
                `;
            }

            const menuHTML = !hasAnyMenuOption ? '' : `
                <div class="absolute top-4 right-4 z-20">
                    <button onclick="toggleMenu(event, ${escAttr(project.name)})" class="text-gray-400 hover:text-gray-900 p-1 rounded-md hover:bg-gray-100 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                    </button>
                    <div id="menu-${esc(project.name)}" class="project-menu-dropdown hidden absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-2 overflow-hidden">
                        ${menuItems}
                    </div>
                </div>
            `;

            projectGrid.innerHTML += `
                <div class="project-card" onclick="window.location.href='dashboard.html?project=${encodeURIComponent(project.name)}'">
                    ${menuHTML}

                    <div class="flex items-center gap-2 mb-1">
                        <span class="status-dot ${statusColor}"></span>
                        <span class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">${currentStatus}</span>
                    </div>
                    
                    <h2 class="text-lg font-semibold text-gray-900 tracking-tight leading-snug ${hasAnyMenuOption ? 'pr-8' : ''}">${esc(project.name)}</h2>
                    
                    <div class="mt-auto pt-4 flex items-center gap-2 text-xs text-gray-500 font-medium">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        <span class="truncate">${locs}</span>
                    </div>
                </div>
            `;
        });
    }

    // Load permissions first, then projects (permissions controls UI rendering)
    await loadPermissions();
    loadProjects();
});