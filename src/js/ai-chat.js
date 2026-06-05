/**
 * src/js/ai-chat.js
 * DoBo AI Assistant — Chat Panel
 *
 * WhatsApp-style chat panel. Glassmorphism design.
 * Persists chat history to localStorage (last 50 messages).
 * Supports model toggle (⚡/🧠), file upload, forward-to-admin.
 */
(function () {
  'use strict';

  class AIChat {
    constructor(panelEl, opts) {
      this.panel      = panelEl;
      this.opts       = opts || {};     // { onOpen, onClose, onMessage, getToken, getContext }
      this.chatHistory = [];
      this.modelType  = localStorage.getItem('dobo-model') || 'standard';
      this._lastAttachedFile = null;
      this._hasMemory = false;
      this._isOpen    = false;
      this._sending   = false;

      this._build();
      this._restoreHistory();
      this._checkMemoryStatus();
    }

    // ── Public ───────────────────────────────────────────────────────────────
    open() {
      this._isOpen = true;
      this.panel.classList.add('open');
      this._scrollToBottom();
      if (this.opts.onOpen) this.opts.onOpen();
      localStorage.setItem('dobo-chat-open', '1');
    }

    close() {
      this._isOpen = false;
      this.panel.classList.remove('open');
      if (this.opts.onClose) this.opts.onClose();
      localStorage.removeItem('dobo-chat-open');
    }

    toggle() {
      this._isOpen ? this.close() : this.open();
    }

    isOpen() { return this._isOpen; }

    addSystemMessage(text) {
      this._appendBubble('assistant', text, false);
      this._scrollToBottom();
    }

    setHasMemory(val) {
      this._hasMemory = val;
      if (this._memoryBadge) {
        this._memoryBadge.classList.toggle('visible', !!val);
      }
      if (this._clearMemBtn) {
        this._clearMemBtn.style.display = val ? '' : 'none';
      }
    }

    // ── Build UI ─────────────────────────────────────────────────────────────
    _build() {
      this.panel.innerHTML = `
        <div class="dobo-panel-header">
          <div class="dobo-avatar-mini">🐰</div>
          <div style="flex:1;min-width:0;">
            <div class="dobo-title">DoBo</div>
            <div class="dobo-subtitle">AI Assistant</div>
          </div>
          <div class="dobo-header-actions">
            <span class="dobo-memory-badge" id="dobo-mem-badge">🧠</span>
            <button class="dobo-btn-icon dobo-model-btn" id="dobo-model-toggle" title="Using fast model — click for powerful model">⚡ Light</button>
            <button class="dobo-btn-icon" id="dobo-close-btn" title="Schließen">✕</button>
          </div>
        </div>

        <div class="dobo-messages" id="dobo-messages">
          <div class="dobo-empty" id="dobo-empty">
            <strong>Hallo! Ich bin DoBo 🐰</strong><br>
            Stell mir eine Frage über DocPilot oder dein Projekt!
          </div>
        </div>

        <div class="dobo-typing" id="dobo-typing">
          <div class="dobo-msg-avatar-spacer"></div>
          <div class="dobo-typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>

        <div class="dobo-input-bar">
          <button class="dobo-attach-btn" id="dobo-attach-btn" title="Datei anhängen">📎</button>
          <input type="file" id="dobo-file-input" style="display:none"
            accept=".pdf,.xlsx,.xls,.csv,.txt,.jpg,.jpeg,.png">
          <input type="text" class="dobo-input-field" id="dobo-input"
            placeholder="Stell mir eine Frage...">
          <button class="dobo-send-btn" id="dobo-send-btn" title="Senden">➤</button>
        </div>

        <div class="dobo-panel-footer">
          <button class="dobo-footer-btn danger" id="dobo-clear-chat">🗑 Chat löschen</button>
          <button class="dobo-footer-btn danger" id="dobo-clear-mem" style="display:none">🧹 Speicher löschen</button>
        </div>
      `;

      // Refs
      this._messagesEl  = this.panel.querySelector('#dobo-messages');
      this._emptyEl     = this.panel.querySelector('#dobo-empty');
      this._typingEl    = this.panel.querySelector('#dobo-typing');
      this._inputEl     = this.panel.querySelector('#dobo-input');
      this._sendBtn     = this.panel.querySelector('#dobo-send-btn');
      this._attachBtn   = this.panel.querySelector('#dobo-attach-btn');
      this._fileInput   = this.panel.querySelector('#dobo-file-input');
      this._closeBtn    = this.panel.querySelector('#dobo-close-btn');
      this._modelToggle = this.panel.querySelector('#dobo-model-toggle');
      this._memoryBadge = this.panel.querySelector('#dobo-mem-badge');
      this._clearChat   = this.panel.querySelector('#dobo-clear-chat');
      this._clearMemBtn = this.panel.querySelector('#dobo-clear-mem');

      this._updateModelToggleUI();

      // Events
      this._closeBtn.addEventListener('click',  () => this.close());
      this._sendBtn.addEventListener('click',   () => this._sendMessage());
      this._inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendMessage(); }
      });
      this._attachBtn.addEventListener('click', () => this._fileInput.click());
      this._fileInput.addEventListener('change', e => this._handleFileUpload(e));
      this._modelToggle.addEventListener('click', () => this._toggleModel());
      this._clearChat.addEventListener('click',  () => this._clearChatHistory());
      this._clearMemBtn.addEventListener('click', () => this._clearMemory());
    }

    // ── Model toggle ─────────────────────────────────────────────────────────
    _toggleModel() {
      this.modelType = this.modelType === 'standard' ? 'pro' : 'standard';
      localStorage.setItem('dobo-model', this.modelType);
      this._updateModelToggleUI();
    }

    _updateModelToggleUI() {
      if (!this._modelToggle) return;
      if (this.modelType === 'pro') {
        this._modelToggle.textContent = '🧠 Heavy';
        this._modelToggle.title = 'Using powerful model — click for fast model';
        this._modelToggle.classList.add('active');
      } else {
        this._modelToggle.textContent = '⚡ Light';
        this._modelToggle.title = 'Using fast model — click for powerful model';
        this._modelToggle.classList.remove('active');
      }
    }

    // ── Send message ─────────────────────────────────────────────────────────
    async _sendMessage() {
      const text = this._inputEl.value.trim();
      if (!text || this._sending) return;

      this._inputEl.value = '';
      this._hideEmpty();
      this._appendBubble('user', text);
      this._showTyping();
      this._sending = true;

      this.chatHistory.push({ role: 'user', content: text });

      try {
        const token   = this.opts.getToken ? this.opts.getToken() : '';
        const context = this.opts.getContext ? this.opts.getContext() : {};
        if (this._lastAttachedFile) {
          context.attachedFile = this._lastAttachedFile;
          this._lastAttachedFile = null;
        }

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify({
            message:     text,
            chatHistory: this.chatHistory.slice(-50),
            context,
            model: this.modelType,
          }),
        });

        const data = await res.json();
        this._hideTyping();

        let reply = data.response || data.error || 'Keine Antwort erhalten.';
        const hasForward = reply.includes('[FORWARD_TO_ADMIN]');
        reply = reply.replace(/\[FORWARD_TO_ADMIN\]/g, '').trim();

        this._appendBubble('assistant', reply, hasForward, context);
        this.chatHistory.push({ role: 'assistant', content: reply });
        this._saveHistory();

        // Memory update
        if (!this._hasMemory) {
          this._hasMemory = true;
          this.setHasMemory(true);
        }

        if (this.opts.onMessage) this.opts.onMessage(reply);

      } catch (err) {
        this._hideTyping();
        this._appendBubble('assistant', 'Verbindungsfehler. Bitte versuche es erneut.');
      } finally {
        this._sending = false;
      }
    }

    // ── Render bubble ─────────────────────────────────────────────────────────
    _appendBubble(role, text, hasForward, ctx) {
      const isUser = role === 'user';
      const row    = document.createElement('div');
      row.className = `dobo-msg-row ${isUser ? 'user' : 'assistant'}`;

      const avatarEl = document.createElement('div');
      avatarEl.className = 'dobo-msg-avatar';
      avatarEl.textContent = isUser ? '👤' : '🐰';

      const bubble = document.createElement('div');
      bubble.className = `dobo-msg-bubble ${isUser ? 'user' : 'assistant'}`;
      bubble.textContent = text;

      const time = document.createElement('span');
      time.className = 'dobo-msg-time';
      time.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      bubble.appendChild(time);

      if (hasForward && !isUser) {
        const fwdBtn = document.createElement('button');
        fwdBtn.className = 'dobo-forward-btn';
        fwdBtn.innerHTML = '📧 An Admin weiterleiten';
        fwdBtn.addEventListener('click', () => this._forwardToAdmin(text, ctx));
        bubble.appendChild(fwdBtn);
      }

      row.appendChild(avatarEl);
      row.appendChild(bubble);
      this._messagesEl.appendChild(row);
      this._scrollToBottom();
    }

    // ── Forward to admin ─────────────────────────────────────────────────────
    async _forwardToAdmin(message, ctx) {
      try {
        const token = this.opts.getToken ? this.opts.getToken() : '';
        const context = ctx || (this.opts.getContext ? this.opts.getContext() : {});
        await fetch('/api/ai/edit-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ message, context }),
        });
        this._appendBubble('assistant', '✅ Deine Anfrage wurde an den Administrator weitergeleitet.');
      } catch (_) {
        this._appendBubble('assistant', '❌ Weiterleitung fehlgeschlagen. Bitte versuche es erneut.');
      }
    }

    // ── File upload ───────────────────────────────────────────────────────────
    async _handleFileUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      this._fileInput.value = '';

      const ctx   = this.opts.getContext ? this.opts.getContext() : {};
      const token = this.opts.getToken ? this.opts.getToken() : '';
      const project = ctx.project || '';

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(`/api/ai/upload?project=${encodeURIComponent(project)}`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          body: formData,
        });
        const data = await res.json();
        if (data.filename) {
          this._lastAttachedFile = data.filename;
          this._inputEl.value = `Ich habe "${data.filename}" angehängt`;
        } else {
          this._appendBubble('assistant', '❌ Upload fehlgeschlagen: ' + (data.error || 'Unbekannter Fehler'));
        }
      } catch (_) {
        this._appendBubble('assistant', '❌ Upload fehlgeschlagen.');
      }
    }

    // ── Memory status ─────────────────────────────────────────────────────────
    async _checkMemoryStatus() {
      try {
        const token   = this.opts.getToken ? this.opts.getToken() : '';
        const context = this.opts.getContext ? this.opts.getContext() : {};
        const project = context.project || '';
        if (!project || !token) return;

        const res  = await fetch(`/api/ai/memory/status?project=${encodeURIComponent(project)}`, {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        const data = await res.json();
        this.setHasMemory(!!data.hasMemory);
      } catch (_) {}
    }

    // ── Clear actions ─────────────────────────────────────────────────────────
    _clearChatHistory() {
      if (!confirm('Chat-Verlauf löschen?')) return;
      this.chatHistory = [];
      this._messagesEl.querySelectorAll('.dobo-msg-row, .dobo-date-sep').forEach(el => el.remove());
      this._showEmpty();
      localStorage.removeItem('dobo-chat-history');
      localStorage.removeItem('dobo-chat-open');
      this.close();
    }

    async _clearMemory() {
      if (!confirm('KI-Speicher für dieses Projekt löschen?')) return;
      try {
        const token   = this.opts.getToken ? this.opts.getToken() : '';
        const context = this.opts.getContext ? this.opts.getContext() : {};
        const project = context.project || '';
        await fetch(`/api/ai/memory?project=${encodeURIComponent(project)}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token },
        });
        this.setHasMemory(false);
        this._appendBubble('assistant', '🧹 Speicher wurde gelöscht. Ich starte frisch!');
      } catch (_) {
        this._appendBubble('assistant', '❌ Speicher konnte nicht gelöscht werden.');
      }
    }

    // ── LocalStorage persistence ──────────────────────────────────────────────
    _saveHistory() {
      const toStore = this.chatHistory.slice(-50).map(m => ({ role: m.role, content: m.content }));
      localStorage.setItem('dobo-chat-history', JSON.stringify(toStore));
    }

    _restoreHistory() {
      try {
        const raw = localStorage.getItem('dobo-chat-history');
        if (!raw) return;
        const msgs = JSON.parse(raw);
        if (!Array.isArray(msgs) || msgs.length === 0) return;
        this.chatHistory = msgs;
        this._hideEmpty();
        msgs.slice(-50).forEach(m => this._appendBubble(m.role, m.content));
        // Restore open state
        if (localStorage.getItem('dobo-chat-open') === '1') {
          setTimeout(() => this.open(), 600);
        }
        this.setHasMemory(true);
      } catch (_) {}
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    _showTyping()  { this._typingEl.classList.add('visible'); this._scrollToBottom(); }
    _hideTyping()  { this._typingEl.classList.remove('visible'); }
    _hideEmpty()   { if (this._emptyEl) { this._emptyEl.style.display = 'none'; } }
    _showEmpty()   { if (this._emptyEl) { this._emptyEl.style.display = ''; } }
    _scrollToBottom() {
      setTimeout(() => { this._messagesEl.scrollTop = this._messagesEl.scrollHeight; }, 50);
    }
  }

  window.AIChat = AIChat;
})();
