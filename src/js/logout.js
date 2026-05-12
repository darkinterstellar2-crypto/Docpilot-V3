/**
 * logout.js — shared logout helper for all pages
 * Calls POST /api/auth/logout to log the session event,
 * then clears localStorage and redirects to login.
 */
async function doLogout() {
    const email = localStorage.getItem('userEmail');
    try {
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
    } catch (e) {
        // Ignore — still log out even if the request fails
    }
    localStorage.clear();
    window.location.href = 'login.html';
}
