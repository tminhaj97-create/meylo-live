// /api/admin-action.js
// Admin-only (see admin-reports.js for the same auth check). Lets the
// admin dismiss a report, or disable/re-enable/delete the reported
// account. Disabling uses Firebase Auth's built-in disabled flag, which
// immediately blocks that account from logging in — reversible via
// "enable", unlike delete.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { action, targetUid, reportId } = req.body || {};
    const db = admin.database();

    try {
        if (action === 'dismiss') {
            if (reportId) await db.ref(`reports/${reportId}`).remove();
            return res.status(200).json({ success: true });
        }

        if (action === 'disable' || action === 'enable') {
            if (!targetUid) return res.status(400).json({ error: 'Missing targetUid' });
            await admin.auth().updateUser(targetUid, { disabled: action === 'disable' });
            if (action === 'disable' && reportId) await db.ref(`reports/${reportId}`).remove();
            return res.status(200).json({ success: true });
        }

        if (action === 'delete') {
            if (!targetUid) return res.status(400).json({ error: 'Missing targetUid' });

            const msgsSnap = await db.ref('messages').once('value');
            const rooms = msgsSnap.val() || {};
            const roomDeletes = Object.keys(rooms)
                .filter(roomId => roomId.includes(targetUid))
                .map(roomId => db.ref(`messages/${roomId}`).remove());
            await Promise.all(roomDeletes);

            const perUserNodes = [
                `users/${targetUid}`, `likesLog/${targetUid}`, `visitsLog/${targetUid}`,
                `passportLog/${targetUid}`, `giftsSentLog/${targetUid}`, `spinClaims/${targetUid}`,
                `adWatchLog/${targetUid}`, `taskClaims/${targetUid}`, `blocks/${targetUid}`,
                `blockedBy/${targetUid}`, `incomingCalls/${targetUid}`
            ];
            await Promise.all(perUserNodes.map(path => db.ref(path).remove()));
            await admin.auth().deleteUser(targetUid);
            if (reportId) await db.ref(`reports/${reportId}`).remove();
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error performing action' });
    }
};
