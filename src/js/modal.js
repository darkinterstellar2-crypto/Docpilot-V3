// Modal System — glassmorphism styled replacements for prompt/confirm/alert
(function() {
    // Create modal container once
    const overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
    overlay.style.cssText = 'display:none; background:rgba(0,0,0,0.3); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); transition:opacity 0.2s;';
    
    const box = document.createElement('div');
    box.id = 'modal-box';
    box.style.cssText = 'background:rgba(255,255,255,0.95); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.6); border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.15),0 4px 16px rgba(0,0,0,0.08); max-width:420px; width:100%; padding:24px; transform:scale(0.95); opacity:0; transition:transform 0.2s ease, opacity 0.2s ease;';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function showModal(html) {
        box.innerHTML = html;
        overlay.style.display = 'flex';
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            box.style.transform = 'scale(1)';
            box.style.opacity = '1';
        });
        // Focus first input or first button
        setTimeout(() => {
            const input = box.querySelector('input');
            const btn = box.querySelector('.modal-primary-btn');
            if (input) { input.focus(); input.select(); }
            else if (btn) btn.focus();
        }, 50);
    }

    function hideModal() {
        box.style.transform = 'scale(0.95)';
        box.style.opacity = '0';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 200);
    }

    const btnBase = 'px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1';
    const btnPrimary = `${btnBase} bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-300 modal-primary-btn`;
    const btnDanger = `${btnBase} bg-red-600 text-white hover:bg-red-700 focus:ring-red-300 modal-primary-btn`;
    const btnCancel = `${btnBase} bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300`;
    const btnOk = `${btnBase} bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-300 modal-primary-btn`;

    window.showAlert = function(message) {
        return new Promise(resolve => {
            showModal(`
                <p class="text-sm text-gray-700 leading-relaxed mb-5">${message}</p>
                <div class="flex justify-end">
                    <button id="modal-ok" class="${btnOk}">OK</button>
                </div>
            `);
            box.querySelector('#modal-ok').addEventListener('click', () => { hideModal(); resolve(); });
        });
    };

    window.showConfirm = function(title, message) {
        return new Promise(resolve => {
            showModal(`
                <h3 class="text-base font-bold text-gray-900 mb-2">${title}</h3>
                <p class="text-sm text-gray-600 leading-relaxed mb-5">${message}</p>
                <div class="flex justify-end gap-2">
                    <button id="modal-cancel" class="${btnCancel}">Cancel</button>
                    <button id="modal-confirm" class="${btnDanger}">Confirm</button>
                </div>
            `);
            box.querySelector('#modal-cancel').addEventListener('click', () => { hideModal(); resolve(false); });
            box.querySelector('#modal-confirm').addEventListener('click', () => { hideModal(); resolve(true); });
            // Escape key
            const esc = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); hideModal(); resolve(false); } };
            document.addEventListener('keydown', esc);
        });
    };

    window.showPrompt = function(title, placeholder, defaultValue) {
        return new Promise(resolve => {
            showModal(`
                <h3 class="text-base font-bold text-gray-900 mb-2">${title}</h3>
                <input id="modal-input" type="text" placeholder="${placeholder || ''}" value="${defaultValue || ''}" 
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 focus:bg-white transition-colors mb-5">
                <div class="flex justify-end gap-2">
                    <button id="modal-cancel" class="${btnCancel}">Cancel</button>
                    <button id="modal-ok" class="${btnPrimary}">OK</button>
                </div>
            `);
            const input = box.querySelector('#modal-input');
            box.querySelector('#modal-cancel').addEventListener('click', () => { hideModal(); resolve(null); });
            box.querySelector('#modal-ok').addEventListener('click', () => { hideModal(); resolve(input.value); });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { hideModal(); resolve(input.value); } });
            const esc = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); hideModal(); resolve(null); } };
            document.addEventListener('keydown', esc);
        });
    };

    // showErrorSelectModal — list all errors for a module, let user pick an action.
    // entries: array of { description: string, fixed: boolean, partIndex: number }
    // Resolves with { action: 'fix'|'reopen'|'edit'|'delete', partIndex, newText? } or null if dismissed.
    window.showErrorSelectModal = function(title, entries) {
        return new Promise(resolve => {
            const activeEntries = entries.filter(e => !e.fixed);
            const fixedEntries  = entries.filter(e => e.fixed);

            const esc2 = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

            // Button style helpers
            const sBtn     = 'flex-shrink:0;padding:5px 11px;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;min-height:32px;line-height:1;';
            const sFix     = sBtn + 'background:#16a34a;color:#fff;';
            const sReopen  = sBtn + 'background:#2563eb;color:#fff;';
            const sEdit    = sBtn + 'background:#f3f4f6;color:#374151;border:1px solid #d1d5db;font-weight:600;';
            const sDel     = sBtn + 'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-weight:600;';
            const sSave    = sBtn + 'background:#2563eb;color:#fff;';
            const sCancel2 = sBtn + 'background:#f3f4f6;color:#374151;border:1px solid #d1d5db;font-weight:600;';
            const sDelConf = sBtn + 'background:#dc2626;color:#fff;';

            function buildEntryHTML(entry, isFixed) {
                const bg = isFixed
                    ? 'background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;'
                    : 'background:#fff1f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;';
                const textStyle = isFixed
                    ? 'font-size:13px;color:#166534;flex:1;line-height:1.4;opacity:0.85;word-break:break-word;'
                    : 'font-size:13px;color:#991b1b;flex:1;line-height:1.4;word-break:break-word;';
                const mainBtn = isFixed
                    ? `<button class="err-reopen-btn" data-part-index="${entry.partIndex}" style="${sReopen}">↩ Reopen</button>`
                    : `<button class="err-fix-btn" data-part-index="${entry.partIndex}" style="${sFix}">✓ Fix</button>`;

                return `<div class="err-entry" data-part-index="${entry.partIndex}" style="${bg}">
                    <div class="err-view" style="display:flex;align-items:flex-start;gap:8px;">
                        <span class="err-text" style="${textStyle}">${esc2(entry.description)}</span>
                        <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;align-items:flex-start;">
                            ${mainBtn}
                            <button class="err-edit-btn" data-part-index="${entry.partIndex}" style="${sEdit}" title="Edit this error">✏</button>
                            <button class="err-del-btn" data-part-index="${entry.partIndex}" style="${sDel}" title="Delete this error">🗑</button>
                        </div>
                    </div>
                    <div class="err-edit-form" style="display:none;margin-top:8px;">
                        <textarea class="err-textarea" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:7px;font-size:13px;resize:vertical;min-height:60px;box-sizing:border-box;background:#fff;outline:none;font-family:inherit;">${esc2(entry.description)}</textarea>
                        <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end;">
                            <button class="err-edit-cancel" style="${sCancel2}">✕ Cancel</button>
                            <button class="err-edit-save" data-part-index="${entry.partIndex}" style="${sSave}">💾 Save</button>
                        </div>
                    </div>
                    <div class="err-del-confirm" style="display:none;margin-top:8px;padding:8px;background:#fff5f5;border-radius:7px;border:1px solid #fca5a5;">
                        <div style="font-size:12px;color:#dc2626;font-weight:600;margin-bottom:6px;">Remove this error entry?</div>
                        <div style="display:flex;gap:6px;justify-content:flex-end;">
                            <button class="err-del-cancel" style="${sCancel2}">✕ No</button>
                            <button class="err-del-confirm-btn" data-part-index="${entry.partIndex}" style="${sDelConf}">🗑 Yes, Delete</button>
                        </div>
                    </div>
                </div>`;
            }

            let html = `<h3 style="font-size:15px;font-weight:700;color:#111827;margin-bottom:14px;">${esc2(title)}</h3>`;

            if (activeEntries.length === 0) {
                html += `<p style="font-size:13px;color:#6b7280;margin-bottom:14px;">No active errors to resolve.</p>`;
            } else {
                html += `<div style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:6px;">🔴 Active Errors:</div>`;
                html += `<div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;margin-bottom:14px;padding-right:2px;">`;
                activeEntries.forEach(entry => { html += buildEntryHTML(entry, false); });
                html += `</div>`;
            }

            if (fixedEntries.length > 0) {
                html += `<div style="font-size:12px;font-weight:600;color:#16a34a;margin-bottom:6px;">✅ Already Fixed:</div>`;
                html += `<div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;margin-bottom:14px;padding-right:2px;">`;
                fixedEntries.forEach(entry => { html += buildEntryHTML(entry, true); });
                html += `</div>`;
            }

            html += `<div style="display:flex;justify-content:flex-end;">
                <button id="modal-error-cancel" style="padding:7px 18px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
            </div>`;

            showModal(html);

            // ── Cancel ──────────────────────────────────────────────────────────
            box.querySelector('#modal-error-cancel').addEventListener('click', () => { hideModal(); resolve(null); });

            // ── Fix buttons ─────────────────────────────────────────────────────
            box.querySelectorAll('.err-fix-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    hideModal();
                    resolve({ action: 'fix', partIndex: parseInt(btn.dataset.partIndex, 10) });
                });
            });

            // ── Reopen buttons ──────────────────────────────────────────────────
            box.querySelectorAll('.err-reopen-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    hideModal();
                    resolve({ action: 'reopen', partIndex: parseInt(btn.dataset.partIndex, 10) });
                });
            });

            // ── Edit — show inline form ─────────────────────────────────────────
            box.querySelectorAll('.err-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const entry = btn.closest('.err-entry');
                    entry.querySelector('.err-view').style.display = 'none';
                    entry.querySelector('.err-del-confirm').style.display = 'none';
                    const form = entry.querySelector('.err-edit-form');
                    form.style.display = '';
                    const ta = form.querySelector('.err-textarea');
                    ta.focus();
                    ta.setSelectionRange(ta.value.length, ta.value.length);
                });
            });

            // ── Edit cancel ─────────────────────────────────────────────────────
            box.querySelectorAll('.err-edit-cancel').forEach(btn => {
                btn.addEventListener('click', () => {
                    const entry = btn.closest('.err-entry');
                    entry.querySelector('.err-edit-form').style.display = 'none';
                    entry.querySelector('.err-view').style.display = 'flex';
                });
            });

            // ── Edit save ───────────────────────────────────────────────────────
            box.querySelectorAll('.err-edit-save').forEach(btn => {
                btn.addEventListener('click', () => {
                    const entry = btn.closest('.err-entry');
                    const newText = entry.querySelector('.err-textarea').value.trim();
                    if (!newText) return;
                    hideModal();
                    resolve({ action: 'edit', partIndex: parseInt(btn.dataset.partIndex, 10), newText });
                });
            });

            // ── Delete — show inline confirm ────────────────────────────────────
            box.querySelectorAll('.err-del-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const entry = btn.closest('.err-entry');
                    entry.querySelector('.err-view').style.display = 'none';
                    entry.querySelector('.err-edit-form').style.display = 'none';
                    entry.querySelector('.err-del-confirm').style.display = '';
                });
            });

            // ── Delete cancel ───────────────────────────────────────────────────
            box.querySelectorAll('.err-del-cancel').forEach(btn => {
                btn.addEventListener('click', () => {
                    const entry = btn.closest('.err-entry');
                    entry.querySelector('.err-del-confirm').style.display = 'none';
                    entry.querySelector('.err-view').style.display = 'flex';
                });
            });

            // ── Delete confirm ──────────────────────────────────────────────────
            box.querySelectorAll('.err-del-confirm-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    hideModal();
                    resolve({ action: 'delete', partIndex: parseInt(btn.dataset.partIndex, 10) });
                });
            });

            const escKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', escKey); hideModal(); resolve(null); } };
            document.addEventListener('keydown', escKey);
        });
    };
})();
