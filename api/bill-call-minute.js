// /api/bill-call-minute.js
//
// Called periodically (roughly once a minute) by whoever is on a call. This
// is what actually deducts coins for call time — the on-screen call timer
// is just a cosmetic clock. We never trust "how long the call has been
// running" from the browser; instead we track a server-side connectedAt
// timestamp on the call record itself and compute elapsed minutes from
// that, so someone can't fake a longer/shorter call duration.

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
    const { callId } = req.body || {};
    if (!callId) return res.status(400).json({ error: 'Missing callId' });

    const db = admin.database();

    try {
        const callSnap = await db.ref(`calls/${callId}`).once('value');
        const call = callSnap.val();
        if (!call || (call.callerId !== uid && call.calleeId !== uid)) {
            return res.status(403).json({ error: 'Not part of this call' });
        }

        // VIP users (real, not-expired) aren't billed for calls.
        const userSnap = await db.ref(`users/${uid}`).once('value');
        const user = userSnap.val() || {};
        const vipActive = user.vip && (!user.vipExpiresAt || Date.now() < user.vipExpiresAt);
        if (vipActive) {
            return res.status(200).json({ billed: 0, vip: true, newCoinBalance: user.coins || 0 });
        }

        // Establish (once) when this call actually connected — first ping
        // right after connecting sets this and bills nothing yet.
        const connResult = await db.ref(`calls/${callId}/connectedAt`).transaction(current => current || Date.now());
        const connectedAt = connResult.snapshot.val();
        const minutesElapsed = Math.floor((Date.now() - connectedAt) / 60000);

        let owedMinutes = 0;
        const billedRef = db.ref(`calls/${callId}/billedMinutes/${uid}`);
        const billedResult = await billedRef.transaction(current => {
            const already = current || 0;
            owedMinutes = Math.max(0, minutesElapsed - already);
            if (owedMinutes <= 0) return; // nothing new owed — abort
            return minutesElapsed;
        });

        if (!billedResult.committed || owedMinutes <= 0) {
            return res.status(200).json({ billed: 0, newCoinBalance: user.coins || 0 });
        }

        const ratePerMinute = call.type === 'video' ? 5 : 4;
        const totalCost = owedMinutes * ratePerMinute;

        if ((user.coins || 0) < totalCost) {
            return res.status(402).json({ error: 'Insufficient coins', newCoinBalance: user.coins || 0 });
        }

        const coinsResult = await db.ref(`users/${uid}/coins`).transaction(current => (current || 0) - totalCost);

        return res.status(200).json({
            billed: totalCost,
            minutesBilled: owedMinutes,
            newCoinBalance: coinsResult.snapshot.val()
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error billing call' });
    }
};
