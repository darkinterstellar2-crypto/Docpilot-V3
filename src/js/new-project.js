document.addEventListener('DOMContentLoaded', () => {
            const userRole = localStorage.getItem('userRole');
            if (!userRole) { window.location.href = 'login.html'; return; }

            // Locations
            const addLocationBtn = document.getElementById('addLocationBtn');
            const locationsList = document.getElementById('locationsList');
            addLocationBtn.addEventListener('click', () => {
                const count = locationsList.children.length + 1;
                const div = document.createElement('div');
                div.className = 'flex items-center gap-2';
                div.innerHTML = `<input type="text" value="Cluster ${String.fromCharCode(64 + count)}" class="input-field w-full px-4 py-3 text-sm location-input"><button class="text-gray-400 hover:text-red-500 px-2 font-bold" onclick="this.parentElement.remove()">&times;</button>`;
                locationsList.appendChild(div);
            });

            // Upload Plan Visuals
            const planUpload = document.getElementById('planUpload');
            const uploadLabel = document.getElementById('uploadLabel');
            planUpload.addEventListener('change', (e) => {
                if(e.target.files.length > 0) {
                    uploadLabel.innerText = "Selected: " + e.target.files[0].name;
                    uploadLabel.classList.add('text-indigo-600');
                }
            });

            // Visual Directory Builder
            
            let customSchema = [
                { title: 'Identification', cols: ['Unique Project ID', 'Metadata'] },
                { title: 'Timing', cols: ['Date', 'Time'] },
                { title: 'Location', cols: ['Los', 'Cluster', 'Knotenpunkt', 'SV/POP'] },
                { title: 'Address', cols: ['Address Start', 'Address End'] },
                { title: 'Hardware', cols: ['Cable name', 'Fiber count'] },
                { title: 'LWL Specs', cols: ['LWL Start', 'LWL End', 'Total'] },
                { title: 'Einblasen', cols: ['Status Einblasen', 'Metrierung total', 'file location', 'Einblasen-Termin', 'Einblasen-Date'] },
                { title: 'Kalibrieren', cols: ['Status', 'Type', 'File Location', 'Einblasen-Termin'] },
                { title: 'Druckprüfung', cols: ['Status', 'Type', 'File Location'] },
                { title: 'Splicing', cols: ['APL status', 'Knotenpunkt Status', 'number of splices', 'APL folder location', 'Knotenpunkt image location', 'APL-Termin'] },
                { title: 'OTDR Testing', cols: ['Status', 'Type', 'Folder Location'] },
                { title: 'Eigentümerdaten', cols: ['Name', 'Phone Number', 'Email', 'Wohneinheiten'] },
                { title: 'Notes', cols: ['Comments', 'Änderungen Auftragnehmer 09.04.2026', 'Error-Reporting'] }
            ];
            const defaultMasterSchema = JSON.stringify(customSchema);
            
            const useDefaultSchema = document.getElementById('useDefaultSchema');
            const schemaBuilderWrapper = document.getElementById('schemaBuilderWrapper');
            const addMainColBtn = document.getElementById('addMainColBtn');
            const schemaBuilder = document.getElementById('schemaBuilder');

            useDefaultSchema.addEventListener('change', (e) => {
                if (e.target.checked) {
                    schemaBuilderWrapper.classList.add('hidden');
                    customSchema = JSON.parse(defaultMasterSchema);
                    renderSchemaBuilder();
                } else {
                    schemaBuilderWrapper.classList.remove('hidden');
                    renderSchemaBuilder();
                }
            });

            addMainColBtn.addEventListener('click', () => {
                const newName = prompt('Enter new Main Column name:');
                if (newName && newName.trim() !== '') { 
                    customSchema.push({ title: newName.trim(), cols: ['New Sub-column'] }); 
                    renderSchemaBuilder(); 
                }
            });

            function renderSchemaBuilder() {
                schemaBuilder.innerHTML = '';
                customSchema.forEach((group, gIndex) => {
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'min-w-[200px] max-w-[200px] bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col shrink-0 overflow-hidden';
                    let html = `
                        <div class="bg-gray-900 text-white p-2.5 flex justify-between items-center border-b border-gray-800">
                            <span class="text-xs font-bold uppercase tracking-wider truncate cursor-pointer hover:text-gray-300 edit-group flex-grow" data-gidx="${gIndex}">${group.title}</span>
                            <button class="text-gray-500 hover:text-red-400 del-group font-bold px-1 text-sm" data-gidx="${gIndex}" title="Delete column group">&times;</button>
                        </div>
                        <div class="p-2 flex flex-col gap-1.5 flex-grow bg-gray-50">
                    `;
                    group.cols.forEach((col, cIndex) => {
                        html += `
                            <div class="flex justify-between items-center bg-white border border-gray-200 px-2.5 py-1.5 rounded-lg text-sm shadow-sm">
                                <span class="truncate text-gray-700 font-medium cursor-pointer hover:text-gray-900 edit-col flex-grow" data-gidx="${gIndex}" data-cidx="${cIndex}">${col}</span>
                                <button class="text-gray-300 hover:text-red-500 del-col font-bold px-1 text-sm" data-gidx="${gIndex}" data-cidx="${cIndex}" title="Delete sub-column">&times;</button>
                            </div>
                        `;
                    });
                    html += `</div><button class="text-xs font-bold text-gray-500 hover:text-gray-900 hover:bg-gray-100 py-2.5 border-t border-gray-200 bg-white add-col transition-colors" data-gidx="${gIndex}">+ Add Sub-Column</button>`;
                    groupDiv.innerHTML = html;
                    schemaBuilder.appendChild(groupDiv);
                });
                attachSchemaListeners();
            }

            function attachSchemaListeners() {
                document.querySelectorAll('.edit-group').forEach(el => el.addEventListener('click', (e) => {
                    const gIdx = e.target.dataset.gidx; const newName = prompt('Rename Main Column:', customSchema[gIdx].title);
                    if (newName) { customSchema[gIdx].title = newName.trim(); renderSchemaBuilder(); }
                }));
                document.querySelectorAll('.del-group').forEach(el => el.addEventListener('click', (e) => {
                    const gIdx = e.target.dataset.gidx; if (confirm('Remove entire column group?')) { customSchema.splice(gIdx, 1); renderSchemaBuilder(); }
                }));
                document.querySelectorAll('.edit-col').forEach(el => el.addEventListener('click', (e) => {
                    const gIdx = e.target.dataset.gidx; const cIdx = e.target.dataset.cidx; const newName = prompt('Rename Sub-Column:', customSchema[gIdx].cols[cIdx]);
                    if (newName) { customSchema[gIdx].cols[cIdx] = newName.trim(); renderSchemaBuilder(); }
                }));
                document.querySelectorAll('.del-col').forEach(el => el.addEventListener('click', (e) => {
                    const gIdx = e.target.dataset.gidx; const cIdx = e.target.dataset.cidx;
                    if (customSchema[gIdx].cols.length <= 1) return alert("Need at least one sub-column.");
                    customSchema[gIdx].cols.splice(cIdx, 1); renderSchemaBuilder();
                }));
                document.querySelectorAll('.add-col').forEach(el => el.addEventListener('click', (e) => {
                    const gIdx = e.target.dataset.gidx; const newName = prompt('Enter new sub-column name:');
                    if (newName) { customSchema[gIdx].cols.push(newName.trim()); renderSchemaBuilder(); }
                }));
            }
// Recursive directory structure — children are objects, not strings
            let defaultStructure = [
                { name: 'APL', children: [{ name: 'NVT', children: [] }, { name: 'SCT', children: [] }] },
                { name: 'Druckprufung', children: [] },
                { name: 'Einblasen', children: [{ name: 'BB', children: [] }, { name: 'HA', children: [] }, { name: 'NVT', children: [] }] },
                { name: 'kalibrieren', children: [] },
                { name: 'Knotenpunkt_Vorbereitung', children: [] },
                { name: 'OTDR', children: [{ name: 'NVT', children: [] }, { name: 'SCT', children: [] }] },
                { name: 'POP_details', children: [] },
                { name: 'SCT_details', children: [] }
            ];

            let customStructure = JSON.parse(JSON.stringify(defaultStructure));
            const directoryTree = document.getElementById('directoryTree');

            // Get a node by path array, e.g. [0, 2, 1] → customStructure[0].children[2].children[1]
            function getNodeByPath(pathArr) {
                let node = { children: customStructure };
                for (const idx of pathArr) {
                    node = node.children[idx];
                }
                return node;
            }

            function renderFolderNode(node, pathArr, depth) {
                const pathStr = JSON.stringify(pathArr);
                const indent = depth * 24;
                const isRoot = depth === 0;
                const iconColor = isRoot ? 'text-indigo-500' : 'text-gray-400';
                const nameClass = isRoot ? 'font-bold' : 'text-gray-600 text-sm';
                const iconSize = isRoot ? 'w-4 h-4' : 'w-3.5 h-3.5';

                let html = `<div class="flex items-center gap-2 py-1${isRoot ? '.5' : ''} px-2 hover:bg-gray-100 rounded-lg transition-colors" style="margin-left:${indent}px">
                    <svg class="${iconSize} ${iconColor} shrink-0" fill="${isRoot ? 'currentColor' : 'none'}" ${isRoot ? '' : 'stroke="currentColor"'} viewBox="0 0 ${isRoot ? '20 20' : '24 24'}">
                        ${isRoot
                            ? '<path d="M2 4a2 2 0 012-2h4.586A2 2 0 0110 2.586L11.414 4H18a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V4z"/>'
                            : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>'}
                    </svg>
                    <span class="${nameClass} flex-grow">${node.name}</span>
                    <div class="flex gap-2 shrink-0">
                        <button class="text-xs text-indigo-600 font-semibold hover:text-indigo-800 tree-add-sub" data-path='${pathStr}'>+ Sub</button>
                        <button class="text-xs text-red-500 font-semibold hover:text-red-700 tree-del" data-path='${pathStr}'>Del</button>
                    </div>
                </div>`;

                if (node.children && node.children.length > 0) {
                    html += `<div class="border-l border-gray-200" style="margin-left:${indent + 12}px">`;
                    node.children.forEach((child, cIdx) => {
                        html += renderFolderNode(child, [...pathArr, cIdx], depth + 1);
                    });
                    html += `</div>`;
                }
                return html;
            }

            function renderTree() {
                let html = '';
                customStructure.forEach((folder, idx) => {
                    html += renderFolderNode(folder, [idx], 0);
                });
                html += `<div class="mt-2 pl-2"><button class="text-xs font-bold text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg" id="addRootFolderBtn">+ Add Root Folder</button></div>`;
                directoryTree.innerHTML = html;

                // Wire up buttons
                directoryTree.querySelectorAll('.tree-add-sub').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const pathArr = JSON.parse(btn.dataset.path);
                        const name = prompt("Sub-folder Name:");
                        if (name && name.trim()) {
                            const node = getNodeByPath(pathArr);
                            if (!node.children) node.children = [];
                            node.children.push({ name: name.trim(), children: [] });
                            renderTree();
                        }
                    });
                });

                directoryTree.querySelectorAll('.tree-del').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (!confirm("Delete folder and all sub-folders?")) return;
                        const pathArr = JSON.parse(btn.dataset.path);
                        if (pathArr.length === 1) {
                            customStructure.splice(pathArr[0], 1);
                        } else {
                            const parentPath = pathArr.slice(0, -1);
                            const parent = getNodeByPath(parentPath);
                            parent.children.splice(pathArr[pathArr.length - 1], 1);
                        }
                        renderTree();
                    });
                });

                const addRootBtn = document.getElementById('addRootFolderBtn');
                if (addRootBtn) {
                    addRootBtn.addEventListener('click', () => {
                        const name = prompt("Folder Name:");
                        if (name && name.trim()) {
                            customStructure.push({ name: name.trim(), children: [] });
                            renderTree();
                        }
                    });
                }
            }

            document.getElementById('resetStructureBtn').addEventListener('click', () => {
                customStructure = JSON.parse(JSON.stringify(defaultStructure));
                renderTree();
            });

            renderTree();

            // ─── Project Info Fields ──────────────────────────────────────────────
            const infoFieldsList = document.getElementById('infoFieldsList');
            const addInfoFieldBtn = document.getElementById('addInfoFieldBtn');

            function createInfoFieldRow(label = '', value = '') {
                const row = document.createElement('div');
                row.className = 'flex items-center gap-2 info-field-row';
                row.innerHTML = `
                    <input type="text" placeholder="Label" value="${label}" class="input-field flex-1 px-3 py-2.5 text-sm info-field-label">
                    <input type="text" placeholder="Value" value="${value}" class="input-field flex-1 px-3 py-2.5 text-sm info-field-value">
                    <button type="button" class="text-gray-400 hover:text-red-500 px-2 font-bold text-lg leading-none flex-shrink-0" title="Remove">&times;</button>
                `;
                row.querySelector('button').addEventListener('click', () => row.remove());
                return row;
            }

            addInfoFieldBtn.addEventListener('click', () => {
                infoFieldsList.appendChild(createInfoFieldRow());
            });

            // ─── Submission ───────────────────────────────────────────────────────
            const createBtn = document.getElementById('createProjectBtn');
            createBtn.addEventListener('click', async () => {
                const projectName = document.getElementById('projectName').value.trim();
                const locInputs = document.querySelectorAll('.location-input');
                const locations = Array.from(locInputs).map(i => i.value.trim()).filter(v => v !== '');

                if (!projectName || locations.length === 0) return alert('Enter name and at least one location.');

                // Collect project info
                const description = document.getElementById('projectDescription').value.trim();
                const fields = Array.from(document.querySelectorAll('.info-field-row')).map(row => ({
                    label: row.querySelector('.info-field-label').value.trim(),
                    value: row.querySelector('.info-field-value').value.trim(),
                })).filter(f => f.label !== '');

                const originalText = createBtn.innerHTML;
                createBtn.innerHTML = 'Generating Hub...';

                // NOTE: Here we would append the File via FormData if sending to backend, 
                // but currently we just send the JSON and tell backend about the structure.
                // We pass 'customStructure' to let backend know how to build folders.
                try {
                    const response = await fetch('/api/projects/create', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-email': localStorage.getItem('userEmail') || 'Unknown' },
                        body: JSON.stringify({ 
                            projectName, 
                            locations, 
                            structure: customStructure,
                            schema: customSchema,
                            description,
                            fields
                        })
                    });
                    const result = await response.json();
                    if (result.success) {
                        window.location.href = 'index.html'; 
                    } else { alert(result.message); }
                } catch (error) { alert('Server failed.'); } 
                finally { createBtn.innerHTML = originalText; }
            });
        });
