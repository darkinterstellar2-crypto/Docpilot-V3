/**
 * geocodeRoutes.js
 * Public Nominatim reverse-geocoding proxy.
 * Mounted BEFORE auth middleware so GeoCam overlay can call it without
 * needing to pass auth headers from the browser.
 * Usage: GET /api/geocode?lat=<lat>&lng=<lng>
 */
const express = require('express');
const router = express.Router();

// Simple in-memory cache: avoid hammering Nominatim for the same coords
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60s

// Basic IP rate limiter: max 30 requests per minute per IP
const rateMap = new Map();
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 30;

function checkRate(ip) {
    const now = Date.now();
    const entry = rateMap.get(ip);
    if (!entry || now - entry.start > RATE_WINDOW) {
        rateMap.set(ip, { start: now, count: 1 });
        return true;
    }
    entry.count++;
    if (entry.count > RATE_MAX) return false;
    return true;
}
// Prune stale entries every 5 min
setInterval(() => {
    const cutoff = Date.now() - RATE_WINDOW;
    for (const [ip, entry] of rateMap) {
        if (entry.start < cutoff) rateMap.delete(ip);
    }
}, 5 * 60 * 1000);

router.get('/', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRate(clientIp)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
    }

    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: 'lat and lng query params required' });
    }

    // Round to ~50m precision for cache key
    const cacheKey = `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.json(cached.data);
    }

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&addressdetails=1&accept-language=de,en`;
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'DocPilot/1.0 (geocode-proxy)' },
        });
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: `Nominatim returned ${upstream.status}` });
        }
        const data = await upstream.json();
        cache.set(cacheKey, { data, ts: Date.now() });
        // Prune cache to prevent unbounded growth
        if (cache.size > 500) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        return res.json(data);
    } catch (err) {
        console.error('[geocode] Nominatim fetch failed:', err.message);
        return res.status(502).json({ error: 'Geocoding failed', detail: err.message });
    }
});

module.exports = router;
