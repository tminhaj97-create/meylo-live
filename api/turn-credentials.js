// /api/turn-credentials.js
//
// Returns a fresh set of ICE servers (STUN + TURN) for WebRTC calls. The
// TURN credentials come from Metered's free Open Relay service — we fetch
// them server-side (never exposing METERED_API_KEY to the browser) and
// hand back just the short-lived iceServers array the client needs.
//
// Required Vercel Environment Variables:
//   METERED_DOMAIN   — e.g. "yourappname.metered.live" (from your Metered dashboard)
//   METERED_API_KEY  — your Metered API key

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const FALLBACK_STUN_ONLY = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];

module.exports = async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    try {
        await admin.auth().verifyIdToken(idToken);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired auth token' });
    }

    const domain = process.env.METERED_DOMAIN;
    const apiKey = process.env.METERED_API_KEY;
    if (!domain || !apiKey) {
        // Not configured yet — degrade gracefully to STUN-only rather than error.
        return res.status(200).json({ iceServers: FALLBACK_STUN_ONLY });
    }

    try {
        const resp = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`);
        if (!resp.ok) return res.status(200).json({ iceServers: FALLBACK_STUN_ONLY });
        const iceServers = await resp.json();
        return res.status(200).json({ iceServers });
    } catch (err) {
        return res.status(200).json({ iceServers: FALLBACK_STUN_ONLY });
    }
};
