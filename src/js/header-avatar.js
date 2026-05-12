/**
 * header-avatar.js — replaces the profile icon in the header with the user's avatar
 * Include this script on every page that has a profile button.
 */
(function() {
    const email = localStorage.getItem('userEmail');
    if (!email) return;

    fetch('/api/profile', {
        headers: {
            'x-user-email': email,
            'x-user-role': localStorage.getItem('userRole') || '',
            'x-user-name': localStorage.getItem('userName') || ''
        }
    })
    .then(r => r.json())
    .then(data => {
        if (!data.success) return;
        const btn = document.querySelector('[title="Profile"]');
        if (!btn) return;

        if (data.profile.avatar) {
            btn.innerHTML = `<img src="${data.profile.avatar}" alt="Profile" class="w-7 h-7 rounded-full object-cover border border-gray-200">`;
        } else {
            const initial = (data.profile.name || '?')[0].toUpperCase();
            btn.innerHTML = `<div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">${initial}</div>`;
        }
    })
    .catch(() => {});
})();
