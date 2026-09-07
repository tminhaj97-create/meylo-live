// /api/send-gift.js
//
// Sending a gift costs coins, so this cannot be done from the client alone
// (the database rules block direct client writes to /coins). This endpoint:
//   1. Verifies the sender's identity via their Firebase ID token.
//   2. Looks up the gift's cost from a SERVER-SIDE catalog (never trusts a
//      price sent by the browser).
//   3. Atomically deducts coins — the transaction aborts if the sender
//      doesn't actually have enough, so balances can never go negative.
//   4. Writes the "gift" chat message itself, so a client can never post a
//      fake "sent a diamond" message without actually paying for it.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const GIFTS = {
    rose: { name: '🌹 Rose', cost: 5 },
    bouquet: { name: '💐 Bouquet', cost: 15 },
    diamond: { name: '💎 Diamond', cost: 50 },
    crown: { name: '👑 Crown', cost: 100 }
};

function roomIdFor(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

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

    const { targetUid, giftId } = req.body || {};
    const gift = GIFTS[giftId];
    if (!gift) return res.status(400).json({ error: 'Unknown gift' });
    if (!targetUid || targetUid === uid) return res.status(400).json({ error: 'Invalid recipient' });

    const db = admin.database();

    try {
        const targetSnap = await db.ref(`users/${targetUid}/name`).once('value');
        if (!targetSnap.exists()) return res.status(404).json({ error: 'Recipient not found' });

        const senderNameSnap = await db.ref(`users/${uid}/name`).once('value');
        const senderName = senderNameSnap.val() || 'Someone';

        // Atomic deduction — aborts (committed:false) if balance is too low,
        // so this can never push a user's coins negative even under
        // concurrent requests.
        const coinsResult = await db.ref(`users/${uid}/coins`).transaction(current => {
            if ((current || 0) < gift.cost) return; // abort
            return current - gift.cost;
        });

        if (!coinsResult.committed) {
            return res.status(402).json({ error: 'Not enough coins' });
        }

        const roomId = roomIdFor(uid, targetUid);
        await db.ref(`messages/${roomId}`).push({
            senderId: uid,
            senderName: senderName,
            type: 'gift',
            giftId: giftId,
            giftName: gift.name,
            timestamp: Date.now()
        });

        const today = new Date().toISOString().slice(0, 10);
        await db.ref(`giftsSentLog/${uid}/${today}`).transaction(current => (current || 0) + 1);

        return res.status(200).json({
            success: true,
            newCoinBalance: coinsResult.snapshot.val()
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error sending gift' });
    }
};
