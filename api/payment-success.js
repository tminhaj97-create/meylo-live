// /api/payment-success.js
//
// SSLCommerz redirects the customer's browser here (via a POST form
// submission) after a payment appears successful. We do NOT trust this
// redirect by itself — anyone could fake a request to this URL. Instead we
// take the val_id it gives us and call SSLCommerz's own Order Validation
// API (server-to-server) to independently confirm the payment really
// happened and for the expected amount, before crediting anything.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

const SSLCZ_BASE = 'https://sandbox.sslcommerz.com';

module.exports = async (req, res) => {
    const body = req.body || {};
    const valId = body.val_id;
    const tranId = body.tran_id;

    const redirectHome = (status) => {
        res.writeHead(302, { Location: `/?payment=${status}` });
        res.end();
    };

    if (!valId || !tranId) return redirectHome('failed');

    const db = admin.database();

    try {
        const orderSnap = await db.ref(`orders/${tranId}`).once('value');
        const order = orderSnap.val();
        if (!order) return redirectHome('failed');

        if (order.status !== 'pending') {
            // Already processed (e.g. duplicate callback) — don't credit twice.
            return redirectHome(order.status === 'completed' ? 'success' : 'failed');
        }

        // Independently verify with SSLCommerz — never trust the redirect alone.
        const params = new URLSearchParams({
            val_id: valId,
            store_id: process.env.SSLCOMMERZ_STORE_ID,
            store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
            format: 'json'
        });
        const verifyResp = await fetch(`${SSLCZ_BASE}/validator/api/validationserverAPI.php?${params.toString()}`);
        const verifyData = await verifyResp.json();

        const validStatus = verifyData.status === 'VALID' || verifyData.status === 'VALIDATED';
        const amountMatches = Math.abs(parseFloat(verifyData.amount) - order.amountBDT) < 0.01;

        if (!validStatus || !amountMatches || verifyData.tran_id !== tranId) {
            await db.ref(`orders/${tranId}/status`).set('failed');
            return redirectHome('failed');
        }

        // Credit the order — coins/vip fields only ever get written here,
        // server-side, after independent verification.
        if (order.type === 'coins') {
            await db.ref(`users/${order.uid}/coins`).transaction(current => (current || 0) + order.coins);
        } else if (order.type === 'vip') {
            const expiresAt = Date.now() + order.vipDays * 24 * 60 * 60 * 1000;
            await db.ref(`users/${order.uid}`).update({ vip: true, vipExpiresAt: expiresAt });
        }

        await db.ref(`orders/${tranId}`).update({ status: 'completed', completedAt: Date.now(), sslValId: valId });
        return redirectHome('success');
    } catch (err) {
        console.error(err);
        return redirectHome('failed');
    }
};
