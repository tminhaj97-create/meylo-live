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
        // NOTE: we deliberately avoid .transaction() here — in this Vercel
        // serverless environment it has shown a reliability issue where it
        // can see a stale/null cached value on the very first call even
        // right after a successful plain read of the same path. Instead we
        // read the real value first, check it, then apply the deduction
        // with an atomic server-side increment (which doesn't depend on
        // the client's local cache being correct — the server applies it
        // relative to whatever the real value is at write time).
        const coinsSnap = await db.ref(`users/${uid}/coins`).once('value');
        const currentCoins = coinsSnap.val() || 0;

        if (currentCoins < BOOST_COST) {
            return res.status(402).json({
                error: `Not enough coins (need ${BOOST_COST})`,
                serverSeesCoins: currentCoins,
                serverSeesUid: uid
            });
        }

        await db.ref(`users/${uid}/coins`).set(admin.database.ServerValue.increment(-BOOST_COST));
        const newBalanceSnap = await db.ref(`users/${uid}/coins`).once('value');

        const boostedUntil = Date.now() + BOOST_DURATION_MS;
        await db.ref(`users/${uid}/boostedUntil`).set(boostedUntil);

        return res.status(200).json({
            success: true,
            boostedUntil,
            newCoinBalance: newBalanceSnap.val()
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error activating boost' });
    }
};
