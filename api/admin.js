// /api/admin.js
//
// Merged admin-reports.js + admin-action.js into one file (GET = list
// reports, POST = perform an action) to stay within Vercel's Hobby-plan
// limit of 12 serverless functions per deployment. Only the account whose
// email matches ADMIN_EMAIL can use this — everyone else gets a 403.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

async function requireAdmin(req) {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (!process.env.ADMIN_EMAIL || decoded.email !== process.env.ADMIN_EMAIL) return null;
        return decoded;
    } catch (err) {
        return null;
    }
}

module.exports = async (req, res) => {
    const decoded = await requireAdmin(req);
    if (!decoded) return res.status(403).json({ error: 'Not authorized' });

    const db = admin.database();

    if (req.method === 'GET') {
        try {
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
    }

    if (req.method === 'POST') {
        const { action, targetUid, reportId } = req.body || {};
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
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
