// /api/boost.js
//
// Boost temporarily makes a profile appear first in other users' Discover
// deck. The expiry timestamp (boostedUntil) is written ONLY here, by the
// server — see database.rules.json, where users/$uid/boostedUntil is
// locked with .validate:false so a client can never set it directly (that
// would let anyone grant themselves a free, unlimited boost).

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const BOOST_COST = 50;
const BOOST_DURATION_MS = 30 * 60 * 1000; // 30 minutes

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
        const coinsResult = await db.ref(`users/${uid}/coins`).transaction(current => {
            if ((current || 0) < BOOST_COST) return; // abort — not enough coins
            return current - BOOST_COST;
        });

        if (!coinsResult.committed) {
            return res.status(402).json({ error: `Not enough coins (need ${BOOST_COST})` });
        }

        const boostedUntil = Date.now() + BOOST_DURATION_MS;
        await db.ref(`users/${uid}/boostedUntil`).set(boostedUntil);

        return res.status(200).json({
            success: true,
            boostedUntil,
            newCoinBalance: coinsResult.snapshot.val()
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error activating boost' });
    }
};
