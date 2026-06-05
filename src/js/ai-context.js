/**
 * src/js/ai-context.js
 * DoBo AI Assistant — Page Context Tracker
 *
 * Receives page context via postMessage from parent pages.
 * Also reads window.parent._doboContext for fine-grained module state.
 */
(function () {
  'use strict';

  class AIContext {
    constructor() {
      this._ctx = {
        page:    '',
        module:  '',
        project: '',
        step:    '',
        address: '',
        language: 'de',
      };
      this._listeners = [];
      this._listenPostMessage();
      this._pollParentContext();
    }

    get() { return { ...this._ctx }; }

    update(patch) {
      Object.assign(this._ctx, patch);
      this._notify();
    }

    onChange(fn) { this._listeners.push(fn); }

    _notify() {
      const ctx = this.get();
      this._listeners.forEach(fn => { try { fn(ctx); } catch (_) {} });
    }

    _listenPostMessage() {
      window.addEventListener('message', e => {
        // Same-origin only
        if (e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.type !== 'dobo-context') return;

        this.update({
          page:    d.page    || '',
          module:  d.module  || '',
          project: d.project || '',
        });
      });
    }

    // Poll window.parent._doboContext for fine-grained step/address
    _pollParentContext() {
      setInterval(() => {
        try {
          const pc = window.parent && window.parent._doboContext;
          if (pc && typeof pc === 'object') {
            let changed = false;
            ['module','step','address'].forEach(k => {
              if (pc[k] !== undefined && pc[k] !== this._ctx[k]) {
                this._ctx[k] = pc[k];
                changed = true;
              }
            });
            if (changed) this._notify();
          }
        } catch (_) {}
      }, 3000);
    }
  }

  window.AIContext = AIContext;
})();
