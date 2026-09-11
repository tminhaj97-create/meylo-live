// /api/delete-account.js
//
// Permanently deletes the caller's own account: their profile, activity
// logs, block lists, chat messages they're part of, and the underlying
// Firebase Auth account itself. This can only ever act on the account
// belonging to the verified token — there is no way to pass in someone
// else's uid.
//
// HONEST LIMITATION: this removes the account's own data nodes and any
// chat rooms it participated in, but does not scan every other user's
// data for stray references (e.g. a message another user's client cached
// locally, or an old report someone filed naming this uid — reports are
// intentionally kept for moderation history). This covers the large
// majority of the user's data but isn't a guaranteed 100% erasure across
// every corner of the database.

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
    const uid = decoded.uid;
    const db = admin.database();

    try {
        // Delete any chat rooms this user was part of.
        const msgsSnap = await db.ref('messages').once('value');
        const rooms = msgsSnap.val() || {};
        const roomDeletes = Object.keys(rooms)
            .filter(roomId => roomId.includes(uid))
            .map(roomId => db.ref(`messages/${roomId}`).remove());
        await Promise.all(roomDeletes);

        // Delete this user's own per-user data nodes.
        const perUserNodes = [
            `users/${uid}`,
            `likesLog/${uid}`,
            `visitsLog/${uid}`,
            `passportLog/${uid}`,
            `giftsSentLog/${uid}`,
            `spinClaims/${uid}`,
            `adWatchLog/${uid}`,
            `taskClaims/${uid}`,
            `blocks/${uid}`,
            `blockedBy/${uid}`,
            `incomingCalls/${uid}`
        ];
        await Promise.all(perUserNodes.map(path => db.ref(path).remove()));

        // Finally, delete the actual login account.
        await admin.auth().deleteUser(uid);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error deleting account' });
    }
};
