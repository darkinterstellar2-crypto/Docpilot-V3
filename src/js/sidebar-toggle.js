(function() {
  // Remove pre-collapsed class once JS takes over (prevents flicker)
  document.documentElement.classList.remove('sidebar-pre-collapsed');

  var sidebar = document.querySelector('.sidebar-nav');
  var main = document.querySelector('.main-content');
  var toggle = document.getElementById('sidebarToggle');
  if (!sidebar || !toggle) return;

  var icon = toggle.querySelector('.material-symbols-outlined');

  function applyState(collapsed) {
    if (collapsed) {
      sidebar.classList.add('sidebar-collapsed');
      if (main) main.classList.add('sidebar-collapsed');
      if (icon) icon.textContent = 'menu';
      toggle.title = 'Expand sidebar';
    } else {
      sidebar.classList.remove('sidebar-collapsed');
      if (main) main.classList.remove('sidebar-collapsed');
      if (icon) icon.textContent = 'menu_open';
      toggle.title = 'Collapse sidebar';
    }
  }

  // Load saved state
  applyState(localStorage.getItem('sidebar-collapsed') === 'true');

  toggle.addEventListener('click', function() {
    var collapsed = !sidebar.classList.contains('sidebar-collapsed');
    localStorage.setItem('sidebar-collapsed', collapsed);
    applyState(collapsed);
  });
})();
