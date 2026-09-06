// /api/watch-ad.js
//
// This runs on Vercel's server, NOT in the browser — so unlike client-side
// JavaScript, a user cannot open dev tools and call this with fake data to
// get free coins. It works like this:
//
//   1. Browser sends the user's Firebase ID token (proof of who they are).
//   2. This function verifies that token with Firebase Admin SDK.
//   3. If valid, it uses the SERVICE ACCOUNT (which bypasses the normal
//      database rules — but only from here, on the server, never from the
//      browser) to safely increment that user's coins by a fixed amount.
//   4. It also checks a per-user daily counter server-side, so someone
//      can't just call this endpoint 500 times in a row for free coins.
//
// Required Vercel Environment Variable: FIREBASE_SERVICE_ACCOUNT
// (the full JSON key you downloaded from Firebase Console, pasted as-is)

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const COINS_PER_AD = 2;
const MAX_ADS_PER_DAY = 20; // adjust as you like

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
        return res.status(401).json({ error: 'Missing auth token' });
    }

    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired auth token' });
    }

    const uid = decoded.uid;
    const db = admin.database();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    try {
        const result = await db.ref(`adWatchLog/${uid}/${today}`).transaction(current => {
            const count = current || 0;
            if (count >= MAX_ADS_PER_DAY) {
                return; // abort transaction — daily limit reached
            }
            return count + 1;
        });

        if (!result.committed) {
            return res.status(429).json({ error: 'Daily ad-watch limit reached' });
        }

        // Safely increment coins using an atomic transaction so concurrent
        // requests can never race each other into an inconsistent value.
        const coinsRef = db.ref(`users/${uid}/coins`);
        const coinsResult = await coinsRef.transaction(current => (current || 0) + COINS_PER_AD);

        return res.status(200).json({
            success: true,
            newCoinBalance: coinsResult.snapshot.val(),
            adsWatchedToday: result.snapshot.val()
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error crediting coins' });
    }
};
