// /api/claim-task.js
//
// Handles claiming rewards for: login, profile, messages, likes.
// (watch-ad has its own endpoint, /api/watch-ad.js, since it has different
// verification logic — a per-ad counter rather than counting existing data.)
//
// For each task, this function independently checks the REAL data in the
// database to decide whether the task is actually complete — it never
// trusts progress numbers sent from the browser. It also uses a one-time
// "claim" transaction per user/day/task so the same reward can't be
// claimed twice.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const TASKS = {
    login: { reward: 5, target: 1 },
    profile: { reward: 5, target: 1 },
    messages: { reward: 5, target: 3 },
    likes: { reward: 5, target: 5 },
    watchad: { reward: 5, target: 1 },
    visit3: { reward: 5, target: 3 },
    passport: { reward: 5, target: 1 },
    sendgift: { reward: 5, target: 1 }
};

function todayStr() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function countTodayMessagesSent(db, uid, day) {
    // Messages are stored per two-person "room" keyed by sorted uids.
    // We only need rooms that involve this user, then count messages they
    // sent today. This reads the whole /messages tree — fine at small
    // scale; for a larger app this would want a per-user message counter
    // maintained by a database trigger instead.
    const snap = await db.ref('messages').once('value');
    const data = snap.val() || {};
    const dayStart = new Date(day + 'T00:00:00.000Z').getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    let count = 0;
    Object.keys(data).forEach(roomId => {
        if (!roomId.includes(uid)) return;
        const msgs = data[roomId] || {};
        Object.values(msgs).forEach(m => {
            if (m && m.senderId === uid && m.timestamp >= dayStart && m.timestamp < dayEnd) {
                count++;
            }
        });
    });
    return count;
}

async function countTodayLikes(db, uid, day) {
    const snap = await db.ref(`likesLog/${uid}/${day}`).once('value');
    const data = snap.val() || {};
    return Object.keys(data).length;
}

async function hasProfileBio(db, uid) {
    const snap = await db.ref(`users/${uid}/bio`).once('value');
    const bio = snap.val();
    return !!(bio && String(bio).trim().length > 0);
}

async function countTodayAdsWatched(db, uid, day) {
    // Written by /api/watch-ad.js — a real server-side counter, not
    // something the client can inflate directly.
    const snap = await db.ref(`adWatchLog/${uid}/${day}`).once('value');
    return snap.val() || 0;
}

async function countTodayVisits(db, uid, day) {
    const snap = await db.ref(`visitsLog/${uid}/${day}`).once('value');
    const data = snap.val() || {};
    return Object.keys(data).length;
}

async function hasUsedPassportToday(db, uid, day) {
    const snap = await db.ref(`passportLog/${uid}/${day}`).once('value');
    return !!snap.val();
}

async function countTodayGiftsSent(db, uid, day) {
    // Written by /api/send-gift.js — server-side, so this can't be faked
    // by a client claiming to have sent a gift without paying for it.
    const snap = await db.ref(`giftsSentLog/${uid}/${day}`).once('value');
    return snap.val() || 0;
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

    const taskId = (req.body && req.body.taskId) || '';
    if (!TASKS[taskId]) {
        return res.status(400).json({ error: 'Unknown task' });
    }

    const db = admin.database();
    const day = todayStr();

    try {
        // 1. Verify the task is actually complete using real data.
        let progress = 0;
        if (taskId === 'login') progress = 1; // being authenticated & calling this endpoint is enough
        if (taskId === 'profile') progress = (await hasProfileBio(db, uid)) ? 1 : 0;
        if (taskId === 'messages') progress = await countTodayMessagesSent(db, uid, day);
        if (taskId === 'likes') progress = await countTodayLikes(db, uid, day);
        if (taskId === 'watchad') progress = await countTodayAdsWatched(db, uid, day);
        if (taskId === 'visit3') progress = await countTodayVisits(db, uid, day);
        if (taskId === 'passport') progress = (await hasUsedPassportToday(db, uid, day)) ? 1 : 0;
        if (taskId === 'sendgift') progress = await countTodayGiftsSent(db, uid, day);

        const target = TASKS[taskId].target;
        if (progress < target) {
            return res.status(400).json({ error: `Task not yet complete (${progress}/${target})`, progress, target });
        }

        // 2. Atomically claim it — this transaction can only succeed once per
        // user per day per task, so replaying the request can't double-pay.
        const claimRef = db.ref(`taskClaims/${uid}/${day}/${taskId}`);
        const claimResult = await claimRef.transaction(current => {
            if (current) return; // abort — already claimed
            return true;
        });

        if (!claimResult.committed) {
            return res.status(409).json({ error: 'Already claimed today' });
        }

        // 3. Credit the reward.
        const reward = TASKS[taskId].reward;
        const coinsResult = await db.ref(`users/${uid}/coins`).transaction(current => (current || 0) + reward);

        return res.status(200).json({
            success: true,
            taskId,
            progress,
            target,
            reward,
            newCoinBalance: coinsResult.snapshot.val()
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error claiming task' });
    }
};
