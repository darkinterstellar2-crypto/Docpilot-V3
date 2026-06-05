/**
 * src/js/ai-thoughts.js
 * DoBo AI Assistant — Proactive Thought Bubbles
 *
 * Idle state machine: detects user inactivity, asks backend for
 * a contextual hint, displays it as a speech bubble near the rabbit.
 */
(function () {
  'use strict';

  class AIThoughts {
    constructor(bubbleEl, opts) {
      this.bubble   = bubbleEl;
      this.opts     = opts || {};   // { getToken, getContext, onBubbleClick }

      this._idleMs      = 0;
      this._lastActivity= Date.now();
      this._visible     = false;
      this._dismissed   = false;
      this._timer       = null;
      this._checkInterval = null;

      this._IDLE_THRESHOLD_MS = 4 * 60 * 1000; // 4 minutes
      this._RESHOW_MS         = 8 * 60 * 1000; // 8 minutes before showing again

      this._trackActivity();
      this._startIdleCheck();

      // Click bubble → open chat
      this.bubble.addEventListener('click', () => {
        this._dismiss();
        if (this.opts.onBubbleClick) this.opts.onBubbleClick();
      });
    }

    updateContext(ctx) {
      this._ctx = ctx;
    }

    forceShow(text) {
      this._showBubble(text);
    }

    dismiss() { this._dismiss(); }

    // ── Internal ─────────────────────────────────────────────────────────────
    _trackActivity() {
      const reset = () => {
        this._lastActivity = Date.now();
        if (this._visible) this._dismiss();
        this._dismissed = false;
      };
      ['mousemove','keydown','touchstart','click','scroll'].forEach(e =>
        window.addEventListener(e, reset, { passive: true })
      );
    }

    _startIdleCheck() {
      this._checkInterval = setInterval(() => {
        if (this._visible || this._dismissed) return;
        const idle = Date.now() - this._lastActivity;
        if (idle >= this._IDLE_THRESHOLD_MS) {
          this._fetchProactiveSuggestion(idle);
        }
      }, 60_000); // check every minute
    }

    async _fetchProactiveSuggestion(idleMs) {
      // Mark dismissed to prevent double-fire while fetching
      this._dismissed = true;

      try {
        const token   = this.opts.getToken  ? this.opts.getToken()  : '';
        const context = this.opts.getContext ? this.opts.getContext() : {};
        if (!token) return;

        const res = await fetch('/api/ai/proactive', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify({ context: { ...context, idleSeconds: Math.floor(idleMs / 1000) } }),
        });

        const data = await res.json();
        const text = data.suggestion || data.response;
        if (text && text.trim()) {
          this._showBubble(text.trim());
        }
      } catch (_) {
        // Silently ignore — proactive is best-effort
        this._dismissed = false;
      }
    }

    _showBubble(text) {
      this.bubble.textContent = text;
      this.bubble.classList.add('visible');
      this._visible = true;

      // Auto-dismiss after 12 seconds
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._dismiss(), 12_000);
    }

    _dismiss() {
      this.bubble.classList.remove('visible');
      this._visible   = false;
      this._dismissed = true;
      clearTimeout(this._timer);

      // Allow re-show after cooldown
      setTimeout(() => { this._dismissed = false; }, this._RESHOW_MS);
    }
  }

  window.AIThoughts = AIThoughts;
})();
