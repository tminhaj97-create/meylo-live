// /api/boost.js
//
// Handles TWO coin-spending actions — 'boost' and 'superlike' — merged into
// one file (instead of two) to stay within Vercel's Hobby-plan limit of 12
// serverless functions per deployment.
//
// boost: temporarily makes a profile appear first in Discover. The expiry
// timestamp (boostedUntil) is written ONLY here, by the server — see
// database.rules.json, where users/$uid/boostedUntil is locked with
// .validate:false so a client can never set it directly.
//
// superlike: like someone in a way that's flagged specially (a star badge,
// shown first in their Liked Me list) — costs more coins than a normal free
// like. The "superLikes" flag is written ONLY here for the same reason.

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
const SUPERLIKE_COST = 20;

// NOTE: we deliberately avoid .transaction() for the coin deduction — in
// this Vercel serverless environment it has shown a reliability issue where
// it can see a stale/null cached value on the very first call even right
// after a successful plain read of the same path. Instead we read the real
// value first, check it, then apply the deduction with an atomic
// server-side increment (which doesn't depend on the client's local cache
// being correct — the server applies it relative to the real value at
// write time).
async function spendCoins(db, uid, amount) {
    const coinsSnap = await db.ref(`users/${uid}/coins`).once('value');
    const currentCoins = coinsSnap.val() || 0;
    if (currentCoins < amount) return { ok: false, currentCoins };

    await db.ref(`users/${uid}/coins`).set(admin.database.ServerValue.increment(-amount));
    const newBalanceSnap = await db.ref(`users/${uid}/coins`).once('value');
    return { ok: true, newCoinBalance: newBalanceSnap.val() };
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
    const action = (req.body && req.body.action) || 'boost';

    try {
        if (action === 'superlike') {
            const targetUid = req.body && req.body.targetUid;
            if (!targetUid || targetUid === uid) return res.status(400).json({ error: 'Invalid target' });

            const targetSnap = await db.ref(`users/${targetUid}/name`).once('value');
            if (!targetSnap.exists()) return res.status(404).json({ error: 'Recipient not found' });

            const spend = await spendCoins(db, uid, SUPERLIKE_COST);
            if (!spend.ok) {
                return res.status(402).json({ error: `Not enough coins (need ${SUPERLIKE_COST})`, serverSeesCoins: spend.currentCoins });
            }

            // Regular reverse-index entry (same as a free like) plus a
            // special flag so the recipient's Liked Me list can show a star
            // and sort this to the top.
            await db.ref(`likedByLog/${targetUid}/${uid}`).set(Date.now());
            await db.ref(`superLikes/${targetUid}/${uid}`).set(true);

            return res.status(200).json({ success: true, newCoinBalance: spend.newCoinBalance });
        }

        // default: boost
        const spend = await spendCoins(db, uid, BOOST_COST);
        if (!spend.ok) {
            return res.status(402).json({
                error: `Not enough coins (need ${BOOST_COST})`,
                serverSeesCoins: spend.currentCoins,
                serverSeesUid: uid
            });
        }

        const boostedUntil = Date.now() + BOOST_DURATION_MS;
        await db.ref(`users/${uid}/boostedUntil`).set(boostedUntil);

        return res.status(200).json({
            success: true,
            boostedUntil,
            newCoinBalance: spend.newCoinBalance
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error processing request' });
    }
};
