// /api/spin.js
//
// The wheel animation is cosmetic (runs in the browser), but the PRIZE and
// whether a spin is even allowed are both decided here, server-side:
//   - Allowed spins today = 1 free + (1 per ad actually watched today, up
//     to 5 bonus) — read from the real adWatchLog written by /api/watch-ad,
//     never from anything the browser claims.
//   - A spinClaims counter (server-only, like taskClaims) records how many
//     spins have already been paid out today, so the same allowance can't
//     be claimed twice.
//   - The prize itself is picked from a weighted table here, not sent by
//     the client, so nobody can claim "I won the jackpot" for free.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const MAX_BONUS_SPINS = 5;
const PRIZE_TABLE = [
    { coins: 1, weight: 30 },
    { coins: 2, weight: 25 },
    { coins: 5, weight: 20 },
    { coins: 10, weight: 15 },
    { coins: 20, weight: 7 },
    { coins: 50, weight: 3 }
];

function pickPrize() {
    const totalWeight = PRIZE_TABLE.reduce((sum, p) => sum + p.weight, 0);
    let r = Math.random() * totalWeight;
    for (const p of PRIZE_TABLE) {
        if (r < p.weight) return p.coins;
        r -= p.weight;
    }
    return PRIZE_TABLE[0].coins;
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
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
    const db = admin.database();
    const day = todayStr();

    try {
        const adsSnap = await db.ref(`adWatchLog/${uid}/${day}`).once('value');
        const adsWatchedToday = adsSnap.val() || 0;
        const allowedSpins = 1 + Math.min(adsWatchedToday, MAX_BONUS_SPINS);

        const claimResult = await db.ref(`spinClaims/${uid}/${day}`).transaction(current => {
            const used = current || 0;
            if (used >= allowedSpins) return; // abort — no spins left
            return used + 1;
        });

        if (!claimResult.committed) {
            return res.status(429).json({
                error: 'No spins available — watch an ad to unlock a bonus spin',
                allowedSpins,
                adsWatchedToday
            });
        }

        const prizeCoins = pickPrize();
        const coinsResult = await db.ref(`users/${uid}/coins`).transaction(current => (current || 0) + prizeCoins);

        return res.status(200).json({
            success: true,
            prizeCoins,
            newCoinBalance: coinsResult.snapshot.val(),
            spinsUsedToday: claimResult.snapshot.val(),
            allowedSpins
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error processing spin' });
    }
};
