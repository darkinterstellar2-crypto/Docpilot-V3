/**
 * src/js/dobo-loader.js
 * DoBo AI Assistant — Direct Page Injection Loader
 * 
 * Replaces the iframe approach. Loads DoBo CSS + scripts directly into the page.
 * All DoBo elements use unique #dobo-* / .dobo-* selectors — no CSS conflicts.
 * 
 * Usage: <script src="/src/js/dobo-loader.js" data-page="dashboard" data-module=""></script>
 */
(function () {
  'use strict';

  // Skip on login/register pages
  if (/login|register/.test(location.pathname)) return;

  // Read page context from script tag attributes
  var scriptTag = document.currentScript;
  var PAGE = (scriptTag && scriptTag.getAttribute('data-page')) || '';
  var MODULE = (scriptTag && scriptTag.getAttribute('data-module')) || '';

  // Expose context for ai-context.js polling
  window._doboContext = {
    page: PAGE,
    module: MODULE,
    project: (function() { try { return localStorage.getItem('selectedProject') || ''; } catch(_) { return ''; } })()
  };

  // Queue for context updates before widget initializes
  window._doboContextQueue = window._doboContextQueue || [];
  window._doboReady = false;

  // Load CSS
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/src/css/ai-widget.css';
  document.head.appendChild(css);

  // Load DoBo scripts in order (face → chat → thoughts → context → widget)
  var scripts = [
    '/src/js/ai-face.js',
    '/src/js/ai-chat.js',
    '/src/js/ai-thoughts.js',
    '/src/js/ai-context.js',
    '/src/js/ai-widget.js'
  ];

  function loadNext(i) {
    if (i >= scripts.length) {
      // All loaded — push initial context
      if (window._doboReady && window._aiContext) {
        window._aiContext.update({ page: PAGE, module: MODULE, project: window._doboContext.project });
      } else {
        window._doboContextQueue.push({ page: PAGE, module: MODULE, project: window._doboContext.project });
      }
      return;
    }
    var s = document.createElement('script');
    s.src = scripts[i];
    s.onload = function () { loadNext(i + 1); };
    s.onerror = function () { console.warn('[DoBo] Failed to load: ' + scripts[i]); loadNext(i + 1); };
    document.body.appendChild(s);
  }

  // Start loading after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadNext(0); });
  } else {
    loadNext(0);
  }
})();
