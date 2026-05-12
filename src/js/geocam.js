/**
 * geocam.js — Standalone Geo-Camera module for DocPilot
 * Exposes window.GeoCam.capture(options) → Promise<{blob, metadata} | null>
 *
 * Opens a fullscreen overlay (appended to document.body, z-index 99999).
 * Flow: camera view → [shutter] → preview (Use Photo / Retake) → resolve.
 * No React, no Next.js, no external deps. Browser APIs only.
 *
 * Settings persist in localStorage under key "geocam-settings-v1".
 * Gear (⚙) button on camera screen opens the settings panel.
 */
(function () {
    'use strict';

    // ── Settings defaults + persistence ───────────────────────────────────────

    var SETTINGS_KEY = 'geocam-settings-v1';

    var DEFAULT_FIELDS = [
        { id: 'datetime',    label: 'Date & Time',     enabled: true,  order: 0 },
        { id: 'address1',    label: 'Street',          enabled: true,  order: 1 },
        { id: 'address2',    label: 'City & Postcode', enabled: true,  order: 2 },
        { id: 'address3',    label: 'Country',         enabled: true,  order: 3 },
        { id: 'coordinates', label: 'Coordinates',     enabled: true,  order: 4 },
        { id: 'altitude',    label: 'Altitude',        enabled: true,  order: 5 },
        { id: 'weather',     label: 'Weather',         enabled: false, order: 6 },
        { id: 'usertext',    label: 'Custom Text',     enabled: true,  order: 7 },
    ];

    var DEFAULT_SETTINGS = {
        dateFormat: 'DD.MM.YYYY',
        timeFormat: 'HH:mm:ss',
        overlayPosition: 'bottom-left',
        overlayColor: '#FFFFFF',
        overlayFontSize: 14,
        overlayFields: DEFAULT_FIELDS,
        userText: '',
        logoDataUrl: null,
        enableHash: false,
    };

    function loadSettings() {
        try {
            var raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            var stored = JSON.parse(raw);
            // Deep-merge fields: preserve defaults for missing, apply stored for existing
            var storedFieldMap = {};
            (stored.overlayFields || []).forEach(function (f) { storedFieldMap[f.id] = f; });
            var mergedFields = DEFAULT_FIELDS.map(function (def) {
                return storedFieldMap[def.id]
                    ? Object.assign({}, def, storedFieldMap[def.id])
                    : Object.assign({}, def);
            });
            return Object.assign({}, DEFAULT_SETTINGS, stored, { overlayFields: mergedFields });
        } catch (e) {
            return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                dateFormat: settings.dateFormat,
                timeFormat: settings.timeFormat,
                overlayPosition: settings.overlayPosition,
                overlayColor: settings.overlayColor,
                overlayFontSize: settings.overlayFontSize,
                overlayFields: settings.overlayFields,
                userText: settings.userText,
                logoDataUrl: settings.logoDataUrl,
                enableHash: settings.enableHash,
            }));
        } catch (e) { /* storage full */ }
    }

    // ── Formatters ────────────────────────────────────────────────────────────

    function fmtDate(d, format) {
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yyyy = d.getFullYear();
        switch (format) {
            case 'MM/DD/YYYY': return mm + '/' + dd + '/' + yyyy;
            case 'YYYY-MM-DD': return yyyy + '-' + mm + '-' + dd;
            case 'DD/MM/YYYY': return dd + '/' + mm + '/' + yyyy;
            default:           return dd + '.' + mm + '.' + yyyy;
        }
    }

    function fmtTime(d, format) {
        var hh24 = d.getHours();
        var mm = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        switch (format) {
            case 'HH:mm': return String(hh24).padStart(2, '0') + ':' + mm;
            case 'hh:mm:ss A': {
                var h12 = hh24 % 12 || 12;
                var ampm = hh24 >= 12 ? 'PM' : 'AM';
                return String(h12).padStart(2, '0') + ':' + mm + ':' + ss + ' ' + ampm;
            }
            default: return String(hh24).padStart(2, '0') + ':' + mm + ':' + ss;
        }
    }

    function fmtCoords(lat, lng) {
        var latDir = lat >= 0 ? 'N' : 'S';
        var lngDir = lng >= 0 ? 'E' : 'W';
        return Math.abs(lat).toFixed(6) + '\u00b0' + latDir + ', ' + Math.abs(lng).toFixed(6) + '\u00b0' + lngDir;
    }

    function fmtAlt(alt) {
        return (alt == null) ? 'Alt: N/A' : 'Alt: ' + Number(alt).toFixed(1) + 'm';
    }

    function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Geo cache ─────────────────────────────────────────────────────────────

    var GEO_CACHE_KEY = 'geocam-pos-v1';

    function getCachedGeo() {
        try {
            var c = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || 'null');
            if (c && Date.now() - c._ts < 30 * 60 * 1000) return c;
        } catch (e) { /* ignore */ }
        return null;
    }

    function setCachedGeo(geo) {
        try {
            localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(Object.assign({}, geo, { _ts: Date.now() })));
        } catch (e) { /* ignore — storage full */ }
    }

    // ── Reverse geocode — debounced Nominatim proxy ───────────────────────────

    var _gcTime = 0, _gcLat = 0, _gcLng = 0, _gcAddr = null;

    async function reverseGeocode(lat, lng) {
        var now = Date.now();
        var dist = Math.hypot(lat - _gcLat, lng - _gcLng);
        if (now - _gcTime < 10000 && dist < 0.0005 && _gcAddr) return _gcAddr;
        try {
            var res = await fetch('/api/geocode?lat=' + lat + '&lng=' + lng);
            if (!res.ok) return _gcAddr;
            var data = await res.json();
            var a = data.address || {};
            var street = [a.road, a.house_number].filter(Boolean).join(' ');
            var city = [a.postcode, a.city || a.town || a.village || a.municipality || ''].filter(Boolean).join(' ');
            _gcAddr = {
                street: street,
                city: city,
                country: a.country || '',
                full: data.display_name || '',
            };
            _gcTime = now; _gcLat = lat; _gcLng = lng;
            return _gcAddr;
        } catch (e) {
            return _gcAddr; // return last known on failure
        }
    }

    // ── SHA-256 hash ──────────────────────────────────────────────────────────

    async function hashBlob(blob) {
        try {
            var buf = await blob.arrayBuffer();
            var hash = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(hash)).map(function (b) {
                return b.toString(16).padStart(2, '0');
            }).join('');
        } catch (e) {
            // crypto.subtle unavailable on HTTP or older browsers
            return '';
        }
    }

    // ── Build overlay text lines ──────────────────────────────────────────────

    function buildLines(settings, geo, now) {
        var lines = [];
        var sortedFields = settings.overlayFields.slice().sort(function (a, b) { return a.order - b.order; });
        for (var i = 0; i < sortedFields.length; i++) {
            var field = sortedFields[i];
            if (!field.enabled) continue;
            switch (field.id) {
                case 'datetime':
                    lines.push(fmtDate(now, settings.dateFormat) + ', ' + fmtTime(now, settings.timeFormat));
                    break;
                case 'address1':
                    if (geo && geo.address) {
                        // Geocode returned — show street if available; omit line if no road found
                        // (avoids a stale "Locating…" when GPS is locked but location has no named road)
                        if (geo.address.street) lines.push(geo.address.street);
                    } else {
                        lines.push('Locating\u2026');
                    }
                    break;
                case 'address2':
                    if (geo && geo.address && geo.address.city) lines.push(geo.address.city);
                    break;
                case 'address3':
                    if (geo && geo.address && geo.address.country) lines.push(geo.address.country);
                    break;
                case 'coordinates':
                    lines.push(geo ? fmtCoords(geo.lat, geo.lng) : 'GPS\u2026');
                    break;
                case 'altitude':
                    if (geo) lines.push(fmtAlt(geo.altitude));
                    break;
                case 'weather':
                    // No weather API integrated
                    break;
                case 'usertext':
                    if (settings.userText && settings.userText.trim()) {
                        settings.userText.split('\n')
                            .map(function (l) { return l.trim(); })
                            .filter(Boolean)
                            .forEach(function (l) { lines.push(l); });
                    }
                    break;
            }
        }
        return lines.filter(Boolean);
    }

    // ── Stamp video frame onto canvas (native resolution) ────────────────────

    async function stampFrame(video, settings, geo, now) {
        var w = video.videoWidth || 1280;
        var h = video.videoHeight || 720;
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);

        var scale = Math.max(w, h) / 1080;
        var baseFontSize = settings.overlayFontSize || 14;
        var fontSize = Math.round(baseFontSize * scale);
        var pad = Math.round(14 * scale);
        var lh = fontSize * 1.45;
        var color = settings.overlayColor || '#FFFFFF';
        var pos = settings.overlayPosition || 'bottom-left';
        var isRight = pos.includes('right');
        var isBottom = pos.includes('bottom');

        ctx.font = '600 ' + fontSize + 'px "JetBrains Mono","Courier New",monospace';
        ctx.fillStyle = color;
        ctx.textAlign = isRight ? 'right' : 'left';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 4 * scale;
        ctx.shadowOffsetX = 1 * scale;
        ctx.shadowOffsetY = 1 * scale;

        var lines = buildLines(settings, geo, now);
        var x = isRight ? w - pad : pad;
        var startY = isBottom ? h - pad - (lines.length - 1) * lh : pad + fontSize;

        lines.forEach(function (line, i) {
            ctx.fillText(line, x, startY + i * lh);
        });

        // ── Logo / Watermark ──────────────────────────────────────────────────
        if (settings.logoDataUrl) {
            await new Promise(function (res) {
                var img = new Image();
                img.onload = function () {
                    var maxLogoH = Math.round(h * 0.08);
                    var logoH = Math.min(img.naturalHeight || maxLogoH, maxLogoH);
                    var logoW = Math.round((img.naturalWidth || logoH) * (logoH / (img.naturalHeight || logoH)));
                    var logoPad = Math.round(12 * scale);
                    // Place logo in the corner opposite to the text
                    var logoX = isRight ? logoPad : w - logoPad - logoW;
                    var logoY = isBottom ? h - logoPad - logoH : logoPad;
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    ctx.drawImage(img, logoX, logoY, logoW, logoH);
                    res();
                };
                img.onerror = function () { res(); };
                img.src = settings.logoDataUrl;
            });
        }

        return new Promise(function (resolve, reject) {
            canvas.toBlob(
                function (blob) { return blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')); },
                'image/jpeg', 0.92
            );
        });
    }

    // ── Settings Panel ────────────────────────────────────────────────────────

    function buildSettingsPanel(settings, onClose, onSettingsChange) {

        // Backdrop (click outside panel to close)
        var backdrop = document.createElement('div');
        backdrop.style.cssText = [
            'position:absolute;inset:0;z-index:100',
            'background:rgba(0,0,0,0.5)',
            'display:flex;justify-content:flex-end',
        ].join(';');

        var panel = document.createElement('div');
        panel.style.cssText = [
            'width:min(360px,100vw)',
            'height:100%',
            'background:#111',
            'display:flex;flex-direction:column',
            'transform:translateX(100%)',
            'transition:transform 0.28s cubic-bezier(0.4,0,0.2,1)',
            'box-shadow:-4px 0 32px rgba(0,0,0,0.6)',
        ].join(';');

        // Animate in
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                panel.style.transform = 'translateX(0)';
            });
        });

        function closePanel() {
            panel.style.transform = 'translateX(100%)';
            setTimeout(function () {
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            }, 290);
            onClose();
        }

        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) closePanel();
        });

        // ── Panel Header ──────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.style.cssText = [
            'display:flex;align-items:center;justify-content:space-between',
            'padding:0 16px;height:56px;flex-shrink:0',
            'border-bottom:1px solid rgba(255,255,255,0.08)',
        ].join(';');

        var headerTitle = document.createElement('h2');
        headerTitle.style.cssText = 'color:#fff;font-size:17px;font-weight:600;margin:0;font-family:inherit;';
        headerTitle.textContent = 'Settings';

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.style.cssText = [
            'width:36px;height:36px;border-radius:50%',
            'background:rgba(255,255,255,0.1);border:none',
            'color:#fff;font-size:20px;line-height:1',
            'display:flex;align-items:center;justify-content:center',
            'cursor:pointer;font-family:inherit;padding:0;flex-shrink:0;',
        ].join(';');
        closeBtn.textContent = '\u00d7';
        closeBtn.addEventListener('click', closePanel);

        header.appendChild(headerTitle);
        header.appendChild(closeBtn);

        // ── Scroll area ───────────────────────────────────────────────────────
        var scrollArea = document.createElement('div');
        scrollArea.style.cssText = [
            'flex:1;overflow-y:auto;padding:16px;',
            '-webkit-overflow-scrolling:touch;',
            'overscroll-behavior:contain;',
        ].join('');
        scrollArea.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });

        // ── UI helpers ────────────────────────────────────────────────────────

        function makeSection(title) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'margin-bottom:24px;';
            var hdr = document.createElement('div');
            hdr.style.cssText = [
                'font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase',
                'color:rgba(255,255,255,0.4);margin-bottom:8px;padding-left:4px;',
            ].join(';');
            hdr.textContent = title;
            wrap.appendChild(hdr);
            return wrap;
        }

        function makeCard() {
            var card = document.createElement('div');
            card.style.cssText = [
                'background:rgba(255,255,255,0.04)',
                'border:1px solid rgba(255,255,255,0.06)',
                'border-radius:12px;padding:12px 16px;',
            ].join(';');
            return card;
        }

        function makeDivider() {
            var d = document.createElement('div');
            d.style.cssText = 'height:1px;background:rgba(255,255,255,0.06);margin:8px 0;';
            return d;
        }

        function makeRowLabel(text) {
            var lbl = document.createElement('p');
            lbl.style.cssText = 'color:rgba(255,255,255,0.6);font-size:13px;margin:0 0 6px 0;font-family:inherit;';
            lbl.textContent = text;
            return lbl;
        }

        function chipStyle(active) {
            return [
                'padding:6px 12px;border-radius:8px;border:none;cursor:pointer;',
                'font-size:12px;font-weight:600;font-family:inherit;',
                active
                    ? 'background:#3B82F6;color:#fff;'
                    : 'background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);',
            ].join('');
        }

        function makeChips(currentValue, options, onChange) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
            options.forEach(function (opt) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.val = opt.value;
                btn.style.cssText = chipStyle(opt.value === currentValue);
                btn.textContent = opt.label;
                btn.addEventListener('click', function () {
                    wrap.querySelectorAll('button').forEach(function (b) {
                        b.style.cssText = chipStyle(b.dataset.val === opt.value);
                    });
                    onChange(opt.value);
                });
                wrap.appendChild(btn);
            });
            return wrap;
        }

        function toggleTrackStyle(on) {
            return [
                'width:44px;height:26px;border-radius:999px;border:none;cursor:pointer;',
                'display:flex;align-items:center;flex-shrink:0;padding:0;',
                'background:' + (on ? '#3B82F6' : 'rgba(255,255,255,0.15)') + ';',
                'transition:background 0.2s;',
            ].join('');
        }

        function toggleKnobStyle(on) {
            return [
                'width:22px;height:22px;border-radius:50%;background:#fff;',
                'box-shadow:0 1px 4px rgba(0,0,0,0.4);pointer-events:none;flex-shrink:0;',
                'transform:translateX(' + (on ? '20px' : '2px') + ');',
                'transition:transform 0.2s;',
            ].join('');
        }

        function makeToggle(initialEnabled, onChange) {
            var enabled = initialEnabled;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = toggleTrackStyle(enabled);
            var knob = document.createElement('div');
            knob.style.cssText = toggleKnobStyle(enabled);
            btn.appendChild(knob);
            btn.addEventListener('click', function () {
                enabled = !enabled;
                btn.style.cssText = toggleTrackStyle(enabled);
                knob.style.cssText = toggleKnobStyle(enabled);
                onChange(enabled);
            });
            return btn;
        }

        function reorderBtnStyle(disabled) {
            return [
                'width:30px;height:30px;border-radius:6px;border:none;cursor:pointer;',
                'background:rgba(255,255,255,0.05);font-size:10px;font-family:inherit;',
                'display:flex;align-items:center;justify-content:center;',
                'color:rgba(255,255,255,' + (disabled ? '0.2' : '0.5') + ');',
                disabled ? 'pointer-events:none;' : '',
            ].join('');
        }

        // ─────────────────────────────────────────────────────────────────────
        // SECTION 1: FORMAT
        // ─────────────────────────────────────────────────────────────────────

        var secFormat = makeSection('Format');
        var cardFormat = makeCard();

        var rowDate = document.createElement('div');
        rowDate.style.cssText = 'padding:4px 0;';
        rowDate.appendChild(makeRowLabel('Date'));
        rowDate.appendChild(makeChips(settings.dateFormat, [
            { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
            { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
            { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
        ], function (v) { settings.dateFormat = v; saveSettings(settings); onSettingsChange(); }));

        cardFormat.appendChild(rowDate);
        cardFormat.appendChild(makeDivider());

        var rowTime = document.createElement('div');
        rowTime.style.cssText = 'padding:4px 0;';
        rowTime.appendChild(makeRowLabel('Time'));
        rowTime.appendChild(makeChips(settings.timeFormat, [
            { value: 'HH:mm:ss',   label: '24h' },
            { value: 'HH:mm',      label: '24h short' },
            { value: 'hh:mm:ss A', label: '12h' },
        ], function (v) { settings.timeFormat = v; saveSettings(settings); onSettingsChange(); }));

        cardFormat.appendChild(rowTime);
        secFormat.appendChild(cardFormat);
        scrollArea.appendChild(secFormat);

        // ─────────────────────────────────────────────────────────────────────
        // SECTION 2: OVERLAY
        // ─────────────────────────────────────────────────────────────────────

        var secOverlay = makeSection('Overlay');
        var cardOverlay = makeCard();

        // Position grid
        var rowPos = document.createElement('div');
        rowPos.style.cssText = 'padding:4px 0;';
        rowPos.appendChild(makeRowLabel('Position'));

        var posGrid = document.createElement('div');
        posGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;';

        var posOptions = [
            { value: 'top-left',     label: '\u2196 Top Left'     },
            { value: 'top-right',    label: '\u2197 Top Right'    },
            { value: 'bottom-left',  label: '\u2199 Bottom Left'  },
            { value: 'bottom-right', label: '\u2198 Bottom Right' },
        ];

        function posBtnStyle(active) {
            return [
                'padding:8px 0;border-radius:8px;border:none;cursor:pointer;',
                'font-size:13px;font-weight:500;font-family:inherit;',
                active ? 'background:#3B82F6;color:#fff;' : 'background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);',
            ].join('');
        }

        posOptions.forEach(function (p) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.pos = p.value;
            btn.style.cssText = posBtnStyle(p.value === settings.overlayPosition);
            btn.textContent = p.label;
            btn.addEventListener('click', function () {
                posGrid.querySelectorAll('button').forEach(function (b) {
                    b.style.cssText = posBtnStyle(b.dataset.pos === p.value);
                });
                settings.overlayPosition = p.value;
                saveSettings(settings);
                onSettingsChange();
            });
            posGrid.appendChild(btn);
        });
        rowPos.appendChild(posGrid);
        cardOverlay.appendChild(rowPos);
        cardOverlay.appendChild(makeDivider());

        // Color presets + custom picker
        var rowColor = document.createElement('div');
        rowColor.style.cssText = 'padding:4px 0;';
        rowColor.appendChild(makeRowLabel('Color'));

        var colorRow = document.createElement('div');
        colorRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

        var presetColors = ['#3B82F6', '#FFFFFF', '#00FF00', '#FF6B35', '#00D4FF', '#FF3B30'];

        function colorDotStyle(c, active) {
            return [
                'width:30px;height:30px;border-radius:50%;cursor:pointer;border:none;',
                'border:2px solid ' + (active ? '#fff' : 'transparent') + ';',
                'transform:' + (active ? 'scale(1.15)' : 'scale(1)') + ';',
                'transition:transform 0.1s,border-color 0.1s;flex-shrink:0;',
                'background:' + c + ';',
            ].join('');
        }

        function updateColorDots(selectedColor) {
            colorRow.querySelectorAll('button[data-color]').forEach(function (b) {
                b.style.cssText = colorDotStyle(b.dataset.color, b.dataset.color === selectedColor);
            });
        }

        presetColors.forEach(function (c) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.color = c;
            btn.style.cssText = colorDotStyle(c, c === settings.overlayColor);
            btn.addEventListener('click', function () {
                settings.overlayColor = c;
                updateColorDots(c);
                customColorInput.value = c;
                saveSettings(settings);
                onSettingsChange();
            });
            colorRow.appendChild(btn);
        });

        // Custom color picker (gradient circle)
        var customColorLabel = document.createElement('label');
        customColorLabel.style.cssText = [
            'width:30px;height:30px;border-radius:50%;overflow:hidden;',
            'position:relative;cursor:pointer;flex-shrink:0;',
            'border:1px solid rgba(255,255,255,0.2);',
            'background:linear-gradient(135deg,#ff0000 0%,#00ff00 50%,#0000ff 100%);',
            'display:flex;align-items:center;justify-content:center;',
        ].join('');

        var customColorSpan = document.createElement('span');
        customColorSpan.style.cssText = 'font-size:14px;font-weight:700;color:#fff;text-shadow:0 0 3px #000;pointer-events:none;line-height:1;';
        customColorSpan.textContent = '+';

        var customColorInput = document.createElement('input');
        customColorInput.type = 'color';
        customColorInput.value = settings.overlayColor;
        customColorInput.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;';
        customColorInput.addEventListener('input', function () {
            settings.overlayColor = customColorInput.value;
            updateColorDots(''); // deselect all presets
            saveSettings(settings);
            onSettingsChange();
        });

        customColorLabel.appendChild(customColorSpan);
        customColorLabel.appendChild(customColorInput);
        colorRow.appendChild(customColorLabel);
        rowColor.appendChild(colorRow);
        cardOverlay.appendChild(rowColor);
        cardOverlay.appendChild(makeDivider());

        // Font size slider
        var rowSize = document.createElement('div');
        rowSize.style.cssText = 'padding:4px 0;';
        var sizeLabelEl = makeRowLabel('Size ' + (settings.overlayFontSize || 14) + 'px');
        rowSize.appendChild(sizeLabelEl);

        var sizeSlider = document.createElement('input');
        sizeSlider.type = 'range';
        sizeSlider.min = '10';
        sizeSlider.max = '24';
        sizeSlider.step = '1';
        sizeSlider.value = String(settings.overlayFontSize || 14);
        sizeSlider.style.cssText = 'width:100%;margin-top:4px;accent-color:#3B82F6;display:block;';
        sizeSlider.addEventListener('input', function () {
            settings.overlayFontSize = Number(sizeSlider.value);
            sizeLabelEl.textContent = 'Size ' + settings.overlayFontSize + 'px';
            saveSettings(settings);
            onSettingsChange();
        });

        rowSize.appendChild(sizeSlider);
        cardOverlay.appendChild(rowSize);
        secOverlay.appendChild(cardOverlay);
        scrollArea.appendChild(secOverlay);

        // ─────────────────────────────────────────────────────────────────────
        // SECTION 3: FIELDS
        // ─────────────────────────────────────────────────────────────────────

        var secFields = makeSection('Fields');
        var cardFields = makeCard();

        function swapFields(fromIdx, toIdx) {
            var sorted = settings.overlayFields.slice().sort(function (a, b) { return a.order - b.order; });
            var tmpOrder = sorted[fromIdx].order;
            sorted[fromIdx].order = sorted[toIdx].order;
            sorted[toIdx].order = tmpOrder;
            saveSettings(settings);
            renderFields();
            onSettingsChange();
        }

        function renderFields() {
            cardFields.innerHTML = '';
            var sorted = settings.overlayFields.slice().sort(function (a, b) { return a.order - b.order; });
            sorted.forEach(function (field, idx) {
                if (idx > 0) cardFields.appendChild(makeDivider());

                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 0;';

                var tgl = makeToggle(field.enabled, function (v) {
                    var f = settings.overlayFields.find(function (x) { return x.id === field.id; });
                    if (f) {
                        f.enabled = v;
                        // Update label color in-place
                        lbl.style.color = v ? '#fff' : 'rgba(255,255,255,0.4)';
                    }
                    saveSettings(settings);
                    onSettingsChange();
                });
                row.appendChild(tgl);

                var lbl = document.createElement('span');
                lbl.style.cssText = 'flex:1;font-size:14px;color:' + (field.enabled ? '#fff' : 'rgba(255,255,255,0.4)') + ';';
                lbl.textContent = field.label;
                row.appendChild(lbl);

                var reorderWrap = document.createElement('div');
                reorderWrap.style.cssText = 'display:flex;gap:2px;';

                var upBtn = document.createElement('button');
                upBtn.type = 'button';
                upBtn.textContent = '\u25b2';
                upBtn.disabled = idx === 0;
                upBtn.style.cssText = reorderBtnStyle(idx === 0);
                upBtn.addEventListener('click', (function (i) {
                    return function () { if (i > 0) swapFields(i, i - 1); };
                })(idx));

                var dnBtn = document.createElement('button');
                dnBtn.type = 'button';
                dnBtn.textContent = '\u25bc';
                dnBtn.disabled = idx === sorted.length - 1;
                dnBtn.style.cssText = reorderBtnStyle(idx === sorted.length - 1);
                dnBtn.addEventListener('click', (function (i, len) {
                    return function () { if (i < len - 1) swapFields(i, i + 1); };
                })(idx, sorted.length));

                reorderWrap.appendChild(upBtn);
                reorderWrap.appendChild(dnBtn);
                row.appendChild(reorderWrap);
                cardFields.appendChild(row);
            });
        }

        renderFields();
        secFields.appendChild(cardFields);
        scrollArea.appendChild(secFields);

        // ─────────────────────────────────────────────────────────────────────
        // SECTION 4: CUSTOM TEXT
        // ─────────────────────────────────────────────────────────────────────

        var secCustom = makeSection('Custom Text');
        var cardCustom = makeCard();

        var textarea = document.createElement('textarea');
        textarea.rows = 4;
        textarea.value = settings.userText || '';
        textarea.placeholder = 'Pop 001\nBGT\nNvt 009\nKassette 1';
        textarea.style.cssText = [
            'width:100%;background:transparent;border:none;outline:none;resize:none;',
            'color:#fff;font-size:14px;font-family:inherit;line-height:1.5;',
            'box-sizing:border-box;',
        ].join('');
        textarea.addEventListener('input', function () {
            settings.userText = textarea.value;
            saveSettings(settings);
            onSettingsChange();
        });

        var textareaHelper = document.createElement('p');
        textareaHelper.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.3);margin:4px 0 0 0;font-family:inherit;';
        textareaHelper.textContent = 'Each line \u2192 separate overlay line';

        cardCustom.appendChild(textarea);
        cardCustom.appendChild(textareaHelper);
        secCustom.appendChild(cardCustom);
        scrollArea.appendChild(secCustom);

        // ─────────────────────────────────────────────────────────────────────
        // SECTION 5: LOGO / WATERMARK
        // ─────────────────────────────────────────────────────────────────────

        var secLogo = makeSection('Logo / Watermark');
        var cardLogo = makeCard();

        var logoFileInput = document.createElement('input');
        logoFileInput.type = 'file';
        logoFileInput.accept = 'image/png,image/svg+xml';
        logoFileInput.style.cssText = 'display:none;';

        var logoInner = document.createElement('div');
        logoInner.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

        var uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.style.cssText = [
            'padding:8px 16px;background:rgba(255,255,255,0.08);border:none;',
            'border-radius:8px;color:#fff;font-size:13px;font-weight:500;cursor:pointer;',
            'font-family:inherit;',
        ].join('');
        uploadBtn.textContent = settings.logoDataUrl ? 'Change' : 'Upload PNG';
        uploadBtn.addEventListener('click', function () { logoFileInput.click(); });

        var thumbImg = null;
        var removeBtn = null;

        function refreshLogoUI() {
            uploadBtn.textContent = settings.logoDataUrl ? 'Change' : 'Upload PNG';
            if (settings.logoDataUrl) {
                if (!thumbImg) {
                    thumbImg = document.createElement('img');
                    thumbImg.style.cssText = 'height:28px;border-radius:4px;max-width:80px;object-fit:contain;';
                    uploadBtn.insertAdjacentElement('afterend', thumbImg);
                }
                thumbImg.src = settings.logoDataUrl;
                if (!removeBtn) {
                    removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.style.cssText = [
                        'background:none;border:none;color:#f87171;',
                        'font-size:13px;cursor:pointer;margin-left:auto;font-family:inherit;',
                    ].join('');
                    removeBtn.textContent = 'Remove';
                    removeBtn.addEventListener('click', function () {
                        settings.logoDataUrl = null;
                        if (thumbImg && thumbImg.parentNode) { thumbImg.parentNode.removeChild(thumbImg); thumbImg = null; }
                        if (removeBtn && removeBtn.parentNode) { removeBtn.parentNode.removeChild(removeBtn); removeBtn = null; }
                        saveSettings(settings);
                        refreshLogoUI();
                    });
                    logoInner.appendChild(removeBtn);
                }
            } else {
                if (thumbImg && thumbImg.parentNode) { thumbImg.parentNode.removeChild(thumbImg); thumbImg = null; }
                if (removeBtn && removeBtn.parentNode) { removeBtn.parentNode.removeChild(removeBtn); removeBtn = null; }
            }
        }

        logoFileInput.addEventListener('change', function () {
            var file = logoFileInput.files && logoFileInput.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                settings.logoDataUrl = reader.result;
                saveSettings(settings);
                refreshLogoUI();
            };
            reader.readAsDataURL(file);
        });

        logoInner.appendChild(uploadBtn);
        refreshLogoUI();
        cardLogo.appendChild(logoFileInput);
        cardLogo.appendChild(logoInner);
        secLogo.appendChild(cardLogo);
        scrollArea.appendChild(secLogo);

        // ─────────────────────────────────────────────────────────────────────
        // SECTION 6: SECURITY
        // ─────────────────────────────────────────────────────────────────────

        var secSecurity = makeSection('Security');
        var cardSecurity = makeCard();

        var secRow = document.createElement('div');
        secRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

        var hashTgl = makeToggle(settings.enableHash, function (v) {
            settings.enableHash = v;
            saveSettings(settings);
        });
        secRow.appendChild(hashTgl);

        var hashTextWrap = document.createElement('div');
        var hashLabel = document.createElement('p');
        hashLabel.style.cssText = 'margin:0;font-size:14px;color:#fff;font-family:inherit;';
        hashLabel.textContent = 'SHA-256 Hash';
        var hashDesc = document.createElement('p');
        hashDesc.style.cssText = 'margin:3px 0 0 0;font-size:11px;color:rgba(255,255,255,0.4);font-family:inherit;';
        hashDesc.textContent = 'Tamper-proof image verification';
        hashTextWrap.appendChild(hashLabel);
        hashTextWrap.appendChild(hashDesc);
        secRow.appendChild(hashTextWrap);
        cardSecurity.appendChild(secRow);
        secSecurity.appendChild(cardSecurity);
        scrollArea.appendChild(secSecurity);

        // ── Assemble panel ────────────────────────────────────────────────────
        panel.appendChild(header);
        panel.appendChild(scrollArea);
        backdrop.appendChild(panel);

        return { el: backdrop, close: closePanel };
    }

    // ── Capture ───────────────────────────────────────────────────────────────

    async function capture(options) {
        // 1. Load stored settings  2. Merge caller options (caller overrides)
        var storedSettings = loadSettings();
        var settings = Object.assign({}, storedSettings, options || {});
        // overlayFields always comes from stored (deep-merged), not caller
        settings.overlayFields = storedSettings.overlayFields;

        return new Promise(function (resolve) {
            var stream = null;
            var watchId = null;
            var facingMode = 'environment';
            var geo = getCachedGeo();
            var clockTimer = null;
            var resolved = false;
            var settingsPanelInstance = null;

            // ── Cleanup ───────────────────────────────────────────────────────

            function cleanup() {
                if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
                if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
                if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
                document.removeEventListener('keydown', _escHandler);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }

            function done(result) {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(result);
            }

            // ── Root overlay ──────────────────────────────────────────────────

            var overlay = document.createElement('div');
            overlay.style.cssText = [
                'position:fixed',
                'inset:0',
                'z-index:99999',
                'background:#000',
                'font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif',
                'overscroll-behavior:none',
                '-webkit-user-select:none',
                'user-select:none',
                'overflow:hidden',
            ].join(';');
            overlay.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

            // ── Camera screen ─────────────────────────────────────────────────

            var camScreen = document.createElement('div');
            camScreen.style.cssText = 'position:absolute;inset:0;display:block;';

            var video = document.createElement('video');
            video.setAttribute('autoplay', '');
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;';

            // Live overlay text (CSS-positioned, NOT canvas)
            function getLiveTextStyle() {
                var pos = settings.overlayPosition || 'bottom-left';
                var isRight = pos.includes('right');
                var isBottom = pos.includes('bottom');
                return [
                    'position:absolute',
                    'z-index:10',
                    'pointer-events:none',
                    'display:flex',
                    'flex-direction:column',
                    'max-width:75vw',
                    isBottom ? 'bottom:88px' : 'top:64px',
                    isRight
                        ? 'right:14px;align-items:flex-end;text-align:right'
                        : 'left:14px;align-items:flex-start;text-align:left',
                ].join(';');
            }

            var liveText = document.createElement('div');
            liveText.style.cssText = getLiveTextStyle();

            // GPS badge (centered top)
            var gpsBadge = document.createElement('div');
            gpsBadge.style.cssText = [
                'position:absolute;top:14px;left:50%;transform:translateX(-50%)',
                'z-index:20;white-space:nowrap',
                'padding:4px 12px;border-radius:999px',
                'font-size:12px;font-weight:600;letter-spacing:0.02em',
                'background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)',
                'color:#fbbf24;transition:color 0.3s',
            ].join(';');
            gpsBadge.textContent = '\u29d9 GPS: Searching\u2026';

            // ⚙ Gear / Settings button (top right)
            var gearBtn = document.createElement('button');
            gearBtn.type = 'button';
            gearBtn.title = 'Settings';
            gearBtn.style.cssText = [
                'position:absolute;top:14px;right:14px;z-index:20',
                'width:38px;height:38px;border-radius:50%;padding:0',
                'background:rgba(0,0,0,0.55);border:1.5px solid rgba(255,255,255,0.2)',
                'color:#fff;font-size:18px;line-height:1',
                'display:flex;align-items:center;justify-content:center',
                'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)',
                'cursor:pointer;font-family:inherit;',
            ].join(';');
            gearBtn.textContent = '\u2699';

            // Shutter flash
            var flash = document.createElement('div');
            flash.style.cssText = [
                'position:absolute;inset:0;z-index:50',
                'background:#fff;opacity:0;pointer-events:none',
                'transition:opacity 0.08s ease-in',
            ].join(';');

            // Bottom controls bar
            var ctrlBar = document.createElement('div');
            ctrlBar.style.cssText = [
                'position:absolute;bottom:0;left:0;right:0;z-index:20',
                'display:flex;align-items:center;justify-content:space-between',
                'padding:20px 28px 40px',
                'background:linear-gradient(to top,rgba(0,0,0,0.7) 0%,transparent 100%)',
            ].join(';');

            var cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.title = 'Cancel';
            cancelBtn.style.cssText = [
                'width:46px;height:46px;border-radius:50%',
                'background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3)',
                'color:#fff;font-size:20px;line-height:1',
                'display:flex;align-items:center;justify-content:center',
                'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)',
                'cursor:pointer;flex-shrink:0;font-family:inherit',
            ].join(';');
            cancelBtn.textContent = '\u2715';

            var shootBtn = document.createElement('button');
            shootBtn.type = 'button';
            shootBtn.title = 'Capture';
            shootBtn.style.cssText = [
                'width:74px;height:74px;border-radius:50%;position:relative',
                'background:#fff;border:4px solid rgba(255,255,255,0.4)',
                'box-shadow:0 0 0 3px rgba(255,255,255,0.18)',
                'cursor:pointer;flex-shrink:0',
                'transition:transform 0.1s;font-family:inherit',
            ].join(';');
            shootBtn.innerHTML = '<div style="position:absolute;inset:7px;border-radius:50%;background:#d1d5db;transition:background 0.1s;"></div>';

            var flipBtn = document.createElement('button');
            flipBtn.type = 'button';
            flipBtn.title = 'Flip Camera';
            flipBtn.style.cssText = [
                'width:46px;height:46px;border-radius:50%',
                'background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3)',
                'color:#fff;font-size:22px;line-height:1',
                'display:flex;align-items:center;justify-content:center',
                'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)',
                'cursor:pointer;flex-shrink:0;font-family:inherit',
            ].join(';');
            flipBtn.innerHTML = '\uD83D\uDD04';

            ctrlBar.appendChild(cancelBtn);
            ctrlBar.appendChild(shootBtn);
            ctrlBar.appendChild(flipBtn);

            camScreen.appendChild(video);
            camScreen.appendChild(liveText);
            camScreen.appendChild(gpsBadge);
            camScreen.appendChild(gearBtn);
            camScreen.appendChild(flash);
            camScreen.appendChild(ctrlBar);

            // ── Preview screen ────────────────────────────────────────────────

            var prevScreen = document.createElement('div');
            prevScreen.style.cssText = 'position:absolute;inset:0;display:none;background:#000;';

            var prevImg = document.createElement('img');
            prevImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';
            prevImg.alt = '';

            var prevBar = document.createElement('div');
            prevBar.style.cssText = [
                'position:absolute;bottom:0;left:0;right:0;z-index:10',
                'display:flex;gap:12px',
                'padding:20px 24px 44px',
                'background:linear-gradient(to top,rgba(0,0,0,0.8) 0%,transparent 100%)',
            ].join(';');

            var prevCancelBtn = document.createElement('button');
            prevCancelBtn.type = 'button';
            prevCancelBtn.title = 'Cancel';
            prevCancelBtn.style.cssText = [
                'width:46px;height:46px;border-radius:50%;flex-shrink:0',
                'background:rgba(255,255,255,0.1);border:1.5px solid rgba(255,255,255,0.25)',
                'color:#fff;font-size:18px;line-height:1',
                'display:flex;align-items:center;justify-content:center',
                'cursor:pointer;font-family:inherit',
            ].join(';');
            prevCancelBtn.textContent = '\u2715';

            var retakeBtn = document.createElement('button');
            retakeBtn.type = 'button';
            retakeBtn.style.cssText = [
                'flex:1;padding:14px;border-radius:12px',
                'background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.3)',
                'color:#fff;font-size:15px;font-weight:700',
                'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)',
                'cursor:pointer;font-family:inherit',
            ].join(';');
            retakeBtn.textContent = '\u21bb Retake';

            var useBtn = document.createElement('button');
            useBtn.type = 'button';
            useBtn.style.cssText = [
                'flex:2;padding:14px;border-radius:12px',
                'background:#16a34a;border:none',
                'color:#fff;font-size:15px;font-weight:700',
                'cursor:pointer;font-family:inherit;transition:background 0.15s',
            ].join(';');
            useBtn.textContent = '\u2713 Use Photo';
            useBtn.addEventListener('mouseenter', function () { useBtn.style.background = '#15803d'; });
            useBtn.addEventListener('mouseleave', function () { useBtn.style.background = '#16a34a'; });

            prevBar.appendChild(prevCancelBtn);
            prevBar.appendChild(retakeBtn);
            prevBar.appendChild(useBtn);
            prevScreen.appendChild(prevImg);
            prevScreen.appendChild(prevBar);

            // ── Permission Gate Screen ────────────────────────────────────────

            var gateScreen = document.createElement('div');
            gateScreen.style.cssText = [
                'position:absolute;inset:0;z-index:10',
                'display:flex;align-items:center;justify-content:center',
                'background:rgba(0,0,0,0.92)',
            ].join(';');

            var gateCard = document.createElement('div');
            gateCard.style.cssText = [
                'background:rgba(255,255,255,0.06)',
                'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)',
                'border:1px solid rgba(255,255,255,0.12)',
                'border-radius:20px',
                'padding:32px 28px 24px',
                'width:min(340px,90vw)',
                'display:flex;flex-direction:column;align-items:center;gap:20px',
            ].join(';');

            // Branding
            var gateBranding = document.createElement('div');
            gateBranding.style.cssText = 'text-align:center;';
            var gateLogo = document.createElement('div');
            gateLogo.style.cssText = 'font-size:40px;margin-bottom:8px;line-height:1;';
            gateLogo.textContent = '\uD83D\uDCF7';
            var gateTitle = document.createElement('div');
            gateTitle.style.cssText = 'color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.02em;';
            gateTitle.textContent = 'GeoCam';
            var gateSubtitle = document.createElement('div');
            gateSubtitle.style.cssText = 'color:rgba(255,255,255,0.4);font-size:13px;margin-top:4px;';
            gateSubtitle.textContent = 'Permission required to continue';
            gateBranding.appendChild(gateLogo);
            gateBranding.appendChild(gateTitle);
            gateBranding.appendChild(gateSubtitle);

            // Permission rows
            var gatePermRows = document.createElement('div');
            gatePermRows.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:8px;';

            function makeStatusBadge(state) {
                var badge = document.createElement('div');
                var configs = {
                    waiting: { text: 'Waiting\u2026', bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' },
                    granted: { text: 'Granted \u2713',  bg: 'rgba(74,222,128,0.15)',  color: '#4ade80' },
                    denied:  { text: 'Denied \u2717',   bg: 'rgba(248,113,113,0.15)', color: '#f87171' },
                    error:   { text: 'GPS Error',        bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
                };
                var cfg = configs[state] || configs.waiting;
                badge.style.cssText = [
                    'padding:4px 10px;border-radius:6px',
                    'font-size:12px;font-weight:600;white-space:nowrap',
                    'background:' + cfg.bg + ';color:' + cfg.color,
                ].join(';');
                badge.textContent = cfg.text;
                return badge;
            }

            function makePermRow(icon, label, initialState) {
                var row = document.createElement('div');
                row.style.cssText = [
                    'display:flex;align-items:center;gap:12px',
                    'background:rgba(255,255,255,0.04)',
                    'border:1px solid rgba(255,255,255,0.07)',
                    'border-radius:12px;padding:14px 16px',
                ].join(';');
                var iconEl = document.createElement('div');
                iconEl.style.cssText = 'font-size:22px;flex-shrink:0;line-height:1;';
                iconEl.textContent = icon;
                var labelEl = document.createElement('div');
                labelEl.style.cssText = 'flex:1;color:#fff;font-size:14px;font-weight:500;';
                labelEl.textContent = label;
                var currentBadge = makeStatusBadge(initialState);
                row.appendChild(iconEl);
                row.appendChild(labelEl);
                row.appendChild(currentBadge);
                return {
                    row: row,
                    updateBadge: function (state) {
                        var nb = makeStatusBadge(state);
                        row.replaceChild(nb, currentBadge);
                        currentBadge = nb;
                    },
                };
            }

            var camPermRow = makePermRow('\uD83D\uDCF7', 'Camera', 'waiting');
            var gpsPermRow = makePermRow('\uD83D\uDCCD', 'Location', 'waiting');
            gatePermRows.appendChild(camPermRow.row);
            gatePermRows.appendChild(gpsPermRow.row);

            // Info message (e.g. browser blocked)
            var gateMsg = document.createElement('div');
            gateMsg.style.cssText = [
                'width:100%;color:rgba(255,255,255,0.45);font-size:12px',
                'text-align:center;line-height:1.55;display:none',
            ].join(';');

            // Buttons
            var gateBtns = document.createElement('div');
            gateBtns.style.cssText = 'width:100%;flex-direction:column;gap:8px;display:none;';

            var gateRetryBtn = document.createElement('button');
            gateRetryBtn.type = 'button';
            gateRetryBtn.style.cssText = [
                'width:100%;padding:13px;border-radius:10px',
                'background:#3B82F6;border:none',
                'color:#fff;font-size:14px;font-weight:700',
                'cursor:pointer;font-family:inherit;',
            ].join(';');
            gateRetryBtn.textContent = '\u21bb Try Again';

            var gateSkipGpsBtn = document.createElement('button');
            gateSkipGpsBtn.type = 'button';
            gateSkipGpsBtn.style.cssText = [
                'width:100%;padding:13px;border-radius:10px',
                'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2)',
                'color:#fff;font-size:14px;font-weight:600',
                'cursor:pointer;font-family:inherit;display:none;',
            ].join(';');
            gateSkipGpsBtn.textContent = 'Continue without GPS';

            var gateCancelGateBtn = document.createElement('button');
            gateCancelGateBtn.type = 'button';
            gateCancelGateBtn.style.cssText = [
                'width:100%;padding:13px;border-radius:10px',
                'background:transparent;border:none',
                'color:rgba(255,255,255,0.35);font-size:13px',
                'cursor:pointer;font-family:inherit;',
            ].join(';');
            gateCancelGateBtn.textContent = 'Cancel';

            gateBtns.appendChild(gateRetryBtn);
            gateBtns.appendChild(gateSkipGpsBtn);
            gateBtns.appendChild(gateCancelGateBtn);

            gateCard.appendChild(gateBranding);
            gateCard.appendChild(gatePermRows);
            gateCard.appendChild(gateMsg);
            gateCard.appendChild(gateBtns);
            gateScreen.appendChild(gateCard);

            // ── Gate permission logic ─────────────────────────────────────────

            var camPermState = 'waiting';
            var gpsPermState = 'waiting';
            var gateAutoProceeded = false;

            function showGateBtns() {
                gateBtns.style.display = 'flex';
                gateBtns.style.flexDirection = 'column';
            }

            function proceedToCamera(skipGps) {
                if (gateAutoProceeded || resolved) return;
                gateAutoProceeded = true;
                gateScreen.style.display = 'none';
                camScreen.style.display = 'block';
                if (skipGps) {
                    geo = null; // ensure GPS fields show N/A
                    gpsBadge.textContent = '\u29d9 GPS: Skipped';
                    gpsBadge.style.color = '#9ca3af';
                } else {
                    updateGpsBadge();
                }
                startCamera();
                updateGpsBadge();
                renderLiveText(new Date());
                clockTimer = setInterval(function () {
                    if (!resolved) renderLiveText(new Date());
                }, 1000);
            }

            function evaluateGateState() {
                if (gateAutoProceeded || resolved) return;
                var camOk = camPermState === 'granted';
                var gpsOk = gpsPermState === 'granted' || gpsPermState === 'error';

                if (camOk && gpsOk) {
                    // Both OK — flash green briefly, then proceed
                    setTimeout(function () { proceedToCamera(false); }, 500);
                    return;
                }

                // At least one denied/pending — show buttons
                showGateBtns();

                // "Continue without GPS" — only when camera OK but GPS denied
                if (camOk && gpsPermState === 'denied') {
                    gateSkipGpsBtn.style.display = 'block';
                } else {
                    gateSkipGpsBtn.style.display = 'none';
                }

                // Helpful message when camera blocked
                if (camPermState === 'denied') {
                    gateMsg.style.display = 'block';
                    gateMsg.textContent = 'Camera access was blocked. Please check your browser settings and allow camera access for this site.';
                } else {
                    gateMsg.style.display = 'none';
                }
            }

            function checkPermissions() {
                // Reset
                camPermState = 'waiting';
                gpsPermState = 'waiting';
                gateAutoProceeded = false;
                camPermRow.updateBadge('waiting');
                gpsPermRow.updateBadge('waiting');
                gateBtns.style.display = 'none';
                gateMsg.style.display = 'none';
                gateSkipGpsBtn.style.display = 'none';

                var camChecked = false;
                var gpsChecked = false;

                function onChecked() {
                    if (camChecked && gpsChecked) evaluateGateState();
                }

                // Camera permission check
                navigator.mediaDevices.getUserMedia({ video: true }).then(function (testStream) {
                    testStream.getTracks().forEach(function (t) { t.stop(); });
                    camPermState = 'granted';
                    camPermRow.updateBadge('granted');
                    camChecked = true;
                    onChecked();
                }).catch(function (err) {
                    camPermState = 'denied';
                    camPermRow.updateBadge('denied');
                    camChecked = true;
                    onChecked();
                });

                // GPS permission check
                if (!navigator.geolocation) {
                    gpsPermState = 'error';
                    gpsPermRow.updateBadge('error');
                    gpsChecked = true;
                    onChecked();
                } else {
                    navigator.geolocation.getCurrentPosition(
                        function () {
                            gpsPermState = 'granted';
                            gpsPermRow.updateBadge('granted');
                            gpsChecked = true;
                            onChecked();
                        },
                        function (err) {
                            if (err.code === 1 /* PERMISSION_DENIED */) {
                                gpsPermState = 'denied';
                                gpsPermRow.updateBadge('denied');
                            } else {
                                // Timeout / position unavailable — not a hard deny, allow continue
                                gpsPermState = 'error';
                                gpsPermRow.updateBadge('error');
                            }
                            gpsChecked = true;
                            onChecked();
                        },
                        { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 }
                    );
                }
            }

            gateRetryBtn.addEventListener('click', function () { checkPermissions(); });
            gateSkipGpsBtn.addEventListener('click', function () { proceedToCamera(true); });
            gateCancelGateBtn.addEventListener('click', function () { done(null); });

            // ── Assemble & mount ──────────────────────────────────────────────

            overlay.appendChild(gateScreen);
            overlay.appendChild(camScreen);
            overlay.appendChild(prevScreen);
            document.body.appendChild(overlay);

            // Camera screen starts hidden — gate controls the show
            camScreen.style.display = 'none';

            // ── Live text rendering ───────────────────────────────────────────

            function renderLiveText(now) {
                liveText.style.cssText = getLiveTextStyle();
                var color = settings.overlayColor || '#FFFFFF';
                var fontSize = settings.overlayFontSize || 14;
                var lines = buildLines(settings, geo, now);
                var spanStyle = [
                    'display:block',
                    'font-size:' + fontSize + 'px',
                    'font-weight:600',
                    'line-height:1.5',
                    'color:' + escHtml(color),
                    'font-family:\'JetBrains Mono\',\'Courier New\',monospace',
                    'text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.6)',
                    'word-break:break-word',
                ].join(';');
                liveText.innerHTML = lines.map(function (l) {
                    return '<span style="' + spanStyle + '">' + escHtml(l) + '</span>';
                }).join('');
            }

            function updateGpsBadge() {
                if (geo && geo.lat) {
                    gpsBadge.textContent = '\u29d9 GPS: ' + geo.lat.toFixed(4) + ', ' + geo.lng.toFixed(4);
                    gpsBadge.style.color = '#4ade80';
                } else {
                    gpsBadge.textContent = '\u29d9 GPS: Searching\u2026';
                    gpsBadge.style.color = '#fbbf24';
                }
            }

            // ── Geolocation ───────────────────────────────────────────────────

            function _setBadgeDenied() {
                gpsBadge.textContent = '\u29d9 GPS: Denied';
                gpsBadge.style.color = '#f87171';
            }

            if (!navigator.geolocation) {
                // API missing (very old browser or programmatically blocked)
                gpsBadge.textContent = '\u29d9 GPS: Unavailable';
                gpsBadge.style.color = '#f87171';
            } else if (
                location.protocol !== 'https:' &&
                location.hostname !== 'localhost' &&
                location.hostname !== '127.0.0.1'
            ) {
                // Geolocation requires a secure context (HTTPS or localhost)
                gpsBadge.textContent = '\u29d9 GPS: Needs HTTPS';
                gpsBadge.style.color = '#f87171';
            } else {
                navigator.geolocation.getCurrentPosition(
                    async function (pos_) {
                        var lat = pos_.coords.latitude, lng = pos_.coords.longitude;
                        var address = await reverseGeocode(lat, lng);
                        geo = { lat: lat, lng: lng, altitude: pos_.coords.altitude, accuracy: pos_.coords.accuracy, address: address };
                        setCachedGeo(geo);
                        updateGpsBadge();
                    },
                    function (err) {
                        // Show badge feedback for denied permission; other errors fall back to cached geo silently
                        if (err.code === 1 /* PERMISSION_DENIED */) _setBadgeDenied();
                    },
                    { enableHighAccuracy: true, maximumAge: 60000, timeout: 8000 }
                );

                watchId = navigator.geolocation.watchPosition(
                    async function (pos_) {
                        var lat = pos_.coords.latitude, lng = pos_.coords.longitude;
                        var address = await reverseGeocode(lat, lng);
                        geo = { lat: lat, lng: lng, altitude: pos_.coords.altitude, accuracy: pos_.coords.accuracy, address: address };
                        setCachedGeo(geo);
                        updateGpsBadge();
                    },
                    function (err) {
                        console.warn('[GeoCam] GPS error:', err.message);
                        if (err.code === 1 /* PERMISSION_DENIED */) _setBadgeDenied();
                    },
                    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
                );
            }

            // ── Camera start/restart ──────────────────────────────────────────

            async function startCamera() {
                if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: { ideal: facingMode },
                            width: { ideal: 3840 },
                            height: { ideal: 2160 },
                        },
                        audio: false,
                    });
                    video.srcObject = stream;
                    await video.play().catch(function () { /* iOS sometimes throws on play() */ });
                } catch (err) {
                    camScreen.innerHTML = [
                        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;',
                        'height:100%;color:#fff;gap:16px;padding:24px;text-align:center;">',
                        '<div style="font-size:48px;">\uD83D\uDCF7</div>',
                        '<div style="font-size:16px;font-weight:700;">Camera Access Denied</div>',
                        '<div style="font-size:13px;color:#9ca3af;max-width:300px;">',
                        escHtml(err.message || 'Unable to access camera. Please allow camera permissions and try again.'),
                        '</div>',
                        '<button id="_gcam_close" type="button" style="padding:12px 28px;background:#fff;color:#111;',
                        'border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;',
                        'margin-top:8px;font-family:inherit;">Close</button>',
                        '</div>',
                    ].join('');
                    var closeEl = document.getElementById('_gcam_close');
                    if (closeEl) closeEl.addEventListener('click', function () { done(null); });
                    return false;
                }
                return true;
            }

            // ── Capture + show preview ────────────────────────────────────────

            var capturedBlob = null;
            var capturedMeta = null;

            async function doCapture() {
                if (!stream || resolved || shootBtn.disabled) return;
                shootBtn.disabled = true;

                flash.style.opacity = '0.75';
                setTimeout(function () { flash.style.opacity = '0'; }, 130);

                var now = new Date();
                try {
                    capturedBlob = await stampFrame(video, settings, geo, now);
                    var hash = settings.enableHash ? await hashBlob(capturedBlob) : '';
                    capturedMeta = {
                        lat: geo ? geo.lat : null,
                        lng: geo ? geo.lng : null,
                        altitude: geo ? geo.altitude : null,
                        address: geo && geo.address
                            ? (geo.address.full || [geo.address.street, geo.address.city, geo.address.country].filter(Boolean).join(', '))
                            : '',
                        timestamp: now,
                        hash: hash,
                    };

                    var blobUrl = URL.createObjectURL(capturedBlob);
                    prevImg.onload = function () { URL.revokeObjectURL(blobUrl); };
                    prevImg.onerror = function () { URL.revokeObjectURL(blobUrl); };
                    prevImg.src = blobUrl;

                    camScreen.style.display = 'none';
                    prevScreen.style.display = 'block';
                } catch (e) {
                    console.error('[GeoCam] Capture error:', e);
                } finally {
                    shootBtn.disabled = false;
                }
            }

            // ── Settings panel ────────────────────────────────────────────────

            gearBtn.addEventListener('click', function () {
                if (settingsPanelInstance) return;
                settingsPanelInstance = buildSettingsPanel(
                    settings,
                    function () { settingsPanelInstance = null; },
                    function () { renderLiveText(new Date()); }
                );
                overlay.appendChild(settingsPanelInstance.el);
            });

            // ── Escape key handler ────────────────────────────────────────────

            function _escHandler(e) {
                if (e.key === 'Escape') {
                    if (settingsPanelInstance) {
                        settingsPanelInstance.close();
                        settingsPanelInstance = null;
                    } else {
                        done(null);
                    }
                }
            }
            document.addEventListener('keydown', _escHandler);

            // ── Event handlers ────────────────────────────────────────────────

            cancelBtn.addEventListener('click', function () { done(null); });
            prevCancelBtn.addEventListener('click', function () { done(null); });

            shootBtn.addEventListener('click', doCapture);
            shootBtn.addEventListener('mousedown', function () { shootBtn.style.transform = 'scale(0.93)'; });
            shootBtn.addEventListener('mouseup', function () { shootBtn.style.transform = ''; });
            shootBtn.addEventListener('touchstart', function () { shootBtn.style.transform = 'scale(0.93)'; }, { passive: true });
            shootBtn.addEventListener('touchend', function () { shootBtn.style.transform = ''; }, { passive: true });

            flipBtn.addEventListener('click', async function () {
                flipBtn.disabled = true;
                flipBtn.style.opacity = '0.5';
                facingMode = facingMode === 'environment' ? 'user' : 'environment';
                await startCamera();
                flipBtn.disabled = false;
                flipBtn.style.opacity = '';
            });

            retakeBtn.addEventListener('click', function () {
                capturedBlob = null;
                capturedMeta = null;
                prevScreen.style.display = 'none';
                camScreen.style.display = 'block';
            });

            useBtn.addEventListener('click', function () {
                if (capturedBlob && capturedMeta) {
                    done({ blob: capturedBlob, metadata: capturedMeta });
                }
            });

            // ── Init ──────────────────────────────────────────────────────────

            // Permission gate runs first; on success it calls startCamera(),
            // updateGpsBadge(), renderLiveText() and starts the clockTimer.
            checkPermissions();
        });
    }

    // ── Export ────────────────────────────────────────────────────────────────

    window.GeoCam = { capture: capture };

})();
