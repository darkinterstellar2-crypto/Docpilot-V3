/**
 * src/js/ai-widget.js
 * DoBo AI Assistant — Main Orchestrator
 *
 * Bunny character sits in the page header (navbar).
 * Chat panel drops down from the bunny on click.
 * No iframe, no floating widget — direct page integration.
 */
(function () {
  'use strict';

  // Skip on login/register pages
  if (/login|register/.test(location.pathname || '')) return;

  // ── Token helper ──────────────────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem('token') || localStorage.getItem('authToken') || '';
  }

  // ── Context ───────────────────────────────────────────────────────────────
  let _contextRef = { page: '', module: '', project: '', step: '', address: '', language: 'de' };
  function getContext() { return { ..._contextRef }; }

  // ── Find the header to inject into ────────────────────────────────────────
  function findHeader() {
    // Look for the glassmorphism header used on all pages
    return document.querySelector('header.glass-header')
      || document.querySelector('header')
      || null;
  }

  // ── Build the bunny button in the header ──────────────────────────────────
  const header = findHeader();
  if (!header) {
    console.warn('[DoBo] No header found — skipping widget');
    return;
  }

  // Find the right-side button group in the header
  const headerRight = header.querySelector('.flex.items-center.gap-2:last-child')
    || header.lastElementChild;

  // Create bunny button
  const rabbitBtn = document.createElement('button');
  rabbitBtn.id = 'dobo-rabbit';
  rabbitBtn.title = 'DoBo AI Assistant';
  rabbitBtn.innerHTML = '<img src="/src/img/dobo-bunny.png" alt="DoBo" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'🐰\';">';
  
  // Insert before the last element (profile button) or append
  if (headerRight && headerRight.children.length > 0) {
    // Add a separator
    const sep = document.createElement('div');
    sep.className = 'w-px h-5 bg-gray-200 mx-1';
    sep.id = 'dobo-separator';
    headerRight.insertBefore(sep, headerRight.firstChild);
    headerRight.insertBefore(rabbitBtn, headerRight.firstChild);
  } else {
    header.appendChild(rabbitBtn);
  }

  // ── Chat panel (dropdown from header) ─────────────────────────────────────
  const panelEl = document.createElement('div');
  panelEl.id = 'dobo-chat-panel';
  document.body.appendChild(panelEl);

  // ── Thought bubble ────────────────────────────────────────────────────────
  const thoughtEl = document.createElement('div');
  thoughtEl.id = 'dobo-thought';
  document.body.appendChild(thoughtEl);

  // ── Position chat panel below the bunny ───────────────────────────────────
  function positionChatPanel() {
    const rect = rabbitBtn.getBoundingClientRect();
    const vw = window.innerWidth;
    const panelW = Math.min(380, vw - 16);

    // On mobile: center it
    if (vw <= 480) {
      panelEl.style.left = ((vw - panelW) / 2) + 'px';
    } else {
      // Align right edge with bunny, but don't go off-screen
      let left = rect.right - panelW;
      if (left < 8) left = 8;
      if (left + panelW > vw - 8) left = vw - panelW - 8;
      panelEl.style.left = left + 'px';
    }
    panelEl.style.top = (rect.bottom + 8) + 'px';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    panelEl.style.width = panelW + 'px';
  }

  // ── Position thought bubble near bunny ────────────────────────────────────
  function positionThought() {
    const rect = rabbitBtn.getBoundingClientRect();
    thoughtEl.style.top = (rect.bottom + 8) + 'px';
    thoughtEl.style.right = (window.innerWidth - rect.right) + 'px';
    thoughtEl.style.bottom = 'auto';
    thoughtEl.style.left = 'auto';
  }

  // ── Stub face (no canvas anymore) ─────────────────────────────────────────
  const face = { setExpression(){}, blink(){}, destroy(){} };

  // ── Instantiate modules ───────────────────────────────────────────────────
  const chat = new window.AIChat(panelEl, {
    getToken,
    getContext,
    onOpen: () => {
      rabbitBtn.classList.add('open');
      positionChatPanel();
    },
    onClose: () => {
      rabbitBtn.classList.remove('open');
    },
  });

  const thoughts = new window.AIThoughts(thoughtEl, {
    getToken,
    getContext,
    onBubbleClick: () => {
      chat.open();
    },
  });

  const context = new window.AIContext();
  context.onChange(ctx => {
    _contextRef = ctx;
    thoughts.updateContext(ctx);
  });

  // Expose globally
  window._aiFace     = face;
  window._aiChat     = chat;
  window._aiThoughts = thoughts;
  window._aiContext   = context;

  // ── Click handler ─────────────────────────────────────────────────────────
  rabbitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chat.toggle();
  });

  // Close chat when clicking outside
  document.addEventListener('click', (e) => {
    if (!chat.isOpen()) return;
    if (panelEl.contains(e.target) || rabbitBtn.contains(e.target)) return;
    chat.close();
  });

  // Reposition on scroll/resize
  window.addEventListener('resize', () => {
    if (chat.isOpen()) positionChatPanel();
  });
  window.addEventListener('scroll', () => {
    if (chat.isOpen()) positionChatPanel();
    positionThought();
  }, { passive: true });

  // ── Sleepy after idle ─────────────────────────────────────────────────────
  let _idleExprTimer = null;
  function resetIdleExpr() {
    clearTimeout(_idleExprTimer);
  }
  ['mousemove','keydown','click','touchstart'].forEach(ev =>
    window.addEventListener(ev, resetIdleExpr, { passive: true })
  );

  // ── Queue processing ─────────────────────────────────────────────────────
  if (Array.isArray(window._doboContextQueue)) {
    window._doboContextQueue.forEach(ctx => context.update(ctx));
    window._doboContextQueue = [];
  }

  // ── Welcome message ──────────────────────────────────────────────────────
  let _welcomed = sessionStorage.getItem('dobo-welcomed');
  const _origOpen = chat.open.bind(chat);
  chat.open = function () {
    _origOpen();
    positionChatPanel();
    if (!_welcomed) {
      _welcomed = '1';
      sessionStorage.setItem('dobo-welcomed', '1');
      setTimeout(() => {
        chat.addSystemMessage('Hallo! Ich bin DoBo 🐰 — wie kann ich dir helfen?');
      }, 400);
    }
  };

  // Detect AI response
  const typingEl = panelEl.querySelector('#dobo-typing');
  if (typingEl) {
    const obs = new MutationObserver(() => {});
    obs.observe(typingEl, { attributes: true, attributeFilter: ['class'] });
  }

  window._doboReady = true;
  console.log('[DoBo] 🐰 Widget ready (navbar mode)');
})();
