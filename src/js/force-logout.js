/**
 * force-logout.js
 * Global fetch interceptor — detects 401 responses from server:
 * - forceLogout: session terminated by admin
 * - tokenExpired: JWT session expired
 * Clears localStorage + redirects to login page.
 * Include this script on every authenticated page.
 */
(function() {
    let _redirecting = false; // prevent multiple redirects
    const _origFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await _origFetch.apply(this, args);

        if (response.status === 401 && !_redirecting) {
            try {
                const cloned = response.clone();
                const data = await cloned.json();
                if (data.forceLogout || data.tokenExpired) {
                    _redirecting = true;
                    localStorage.removeItem('userRole');
                    localStorage.removeItem('userEmail');
                    localStorage.removeItem('userName');
                    localStorage.removeItem('authToken');
                    const msg = data.forceLogout
                        ? 'Your session has been terminated by an administrator.'
                        : 'Your session has expired. Please log in again.';
                    alert(msg);
                    window.location.href = 'login.html';
                    return new Response(JSON.stringify(data), { status: 401 });
                }
            } catch (_) {}
        }

        return response;
    };
})();
