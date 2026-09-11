// /api/admin-reports.js
// Only the account whose email matches the ADMIN_EMAIL environment
// variable can call this. Everyone else gets a 403 — the "reports" node
// itself is unreadable by any client per database.rules.json, so this is
// the only way to see them at all (besides the Firebase Console directly).

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

module.exports = async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired auth token' });
    }

    if (!process.env.ADMIN_EMAIL || decoded.email !== process.env.ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    try {
        const db = admin.database();
        const snap = await db.ref('reports').once('value');
        const data = snap.val() || {};
        const reports = Object.keys(data)
            .map(id => ({ id, ...data[id] }))
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return res.status(200).json({ reports });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error loading reports' });
    }
};
