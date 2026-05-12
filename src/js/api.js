/**
 * api.js — Global fetch interceptor
 * 
 * 1. Sends JWT token as Authorization: Bearer header on every /api/ request.
 * 2. Auto-refreshes token when it's within 30 min of expiry (silent, no user action).
 * 3. Falls back to legacy x-user-email/x-user-role headers for backward compat.
 * 
 * Include this script BEFORE any other JS on every page.
 */
(function() {
    const _origFetch = window.fetch;
    let _refreshing = null; // single in-flight refresh promise (prevents parallel refresh calls)

    /**
     * Decode JWT payload without verification (client-side expiry check only).
     * Returns null if token is malformed.
     */
    function decodeToken(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            return payload;
        } catch (_) {
            return null;
        }
    }

    /**
     * Check if token expires within the next 30 minutes.
     */
    function needsRefresh(token) {
        const payload = decodeToken(token);
        if (!payload || !payload.exp) return false;
        const nowSec = Math.floor(Date.now() / 1000);
        const timeLeft = payload.exp - nowSec;
        return timeLeft > 0 && timeLeft <= 30 * 60; // within 30 min of expiry
    }

    /**
     * Silently refresh the token. Returns the new token or null on failure.
     * Uses a shared promise so concurrent requests don't fire multiple refreshes.
     */
    function refreshToken(currentToken) {
        if (_refreshing) return _refreshing;

        _refreshing = _origFetch('/api/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            }
        })
        .then(function(resp) {
            if (!resp.ok) return null;
            return resp.json();
        })
        .then(function(data) {
            if (data && data.refreshed && data.token) {
                localStorage.setItem('authToken', data.token);
                return data.token;
            }
            return null;
        })
        .catch(function() {
            return null;
        })
        .finally(function() {
            _refreshing = null;
        });

        return _refreshing;
    }

    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url.startsWith('/api/') || url.includes('/api/')) {
            init = init || {};
            const headers = new Headers(init.headers || {});

            // JWT token (primary auth)
            let token = localStorage.getItem('authToken');

            // Auto-refresh if close to expiry (but not for the refresh endpoint itself)
            if (token && needsRefresh(token) && !url.includes('/api/refresh')) {
                const newToken = await refreshToken(token);
                if (newToken) token = newToken;
            }

            if (token && !headers.has('Authorization')) {
                headers.set('Authorization', 'Bearer ' + token);
            }

            // Legacy headers (backward compat — will be removed after full migration)
            if (!headers.has('x-user-email')) {
                headers.set('x-user-email', localStorage.getItem('userEmail') || '');
            }
            if (!headers.has('x-user-role')) {
                headers.set('x-user-role', localStorage.getItem('userRole') || '');
            }
            init.headers = headers;
        }
        return _origFetch.call(this, input, init);
    };
})();
