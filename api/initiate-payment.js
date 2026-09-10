// /api/initiate-payment.js
//
// Starts an SSLCommerz payment session. The price/coin amounts come from a
// SERVER-SIDE catalog below — never from anything the browser sends — so a
// user can't tamper with the request to pay less than the real price for
// more coins. We also record a "pending" order in the database before
// redirecting to SSLCommerz, so that when the payment completes we know
// exactly what to credit and to whom.

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

// ⚠️ Placeholder pricing — adjust these BDT amounts to whatever you actually
// want to charge before going live.
const PACKAGES = {
    bronze: { type: 'coins', coins: 100, amountBDT: 100 },
    popular: { type: 'coins', coins: 300, amountBDT: 250 },
    best: { type: 'coins', coins: 1000, amountBDT: 750 },
    vip_monthly: { type: 'vip', vipDays: 30, amountBDT: 500 }
};

const SSLCZ_BASE = 'https://sandbox.sslcommerz.com'; // sandbox only for now

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
    const email = decoded.email || 'customer@example.com';

    const { packageId } = req.body || {};
    const pkg = PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: 'Unknown package' });

    const db = admin.database();

    try {
        const nameSnap = await db.ref(`users/${uid}/name`).once('value');
        const custName = nameSnap.val() || 'Meylo User';

        const tranId = `${uid}_${Date.now()}`;
        await db.ref(`orders/${tranId}`).set({
            uid,
            packageId,
            amountBDT: pkg.amountBDT,
            type: pkg.type,
            coins: pkg.coins || 0,
            vipDays: pkg.vipDays || 0,
            status: 'pending',
            createdAt: Date.now()
        });

        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const baseUrl = `${proto}://${host}`;

        const params = new URLSearchParams({
            store_id: process.env.SSLCOMMERZ_STORE_ID,
            store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
            total_amount: String(pkg.amountBDT),
            currency: 'BDT',
            tran_id: tranId,
            success_url: `${baseUrl}/api/payment-success`,
            fail_url: `${baseUrl}/api/payment-fail`,
            cancel_url: `${baseUrl}/api/payment-cancel`,
            cus_name: custName,
            cus_email: email,
            cus_add1: 'Dhaka',
            cus_city: 'Dhaka',
            cus_postcode: '1000',
            cus_country: 'Bangladesh',
            cus_phone: '01700000000',
            shipping_method: 'NO',
            product_name: pkg.type === 'vip' ? 'Meylo VIP Pass' : 'Meylo Coins',
            product_category: 'Digital Goods',
            product_profile: 'general',
            num_of_item: '1'
        });

        const sslResp = await fetch(`${SSLCZ_BASE}/gwprocess/v4/api.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        const sslData = await sslResp.json();

        if (sslData.status !== 'SUCCESS' || !sslData.GatewayPageURL) {
            await db.ref(`orders/${tranId}/status`).set('init_failed');
            return res.status(502).json({ error: sslData.failedreason || 'Could not start payment session' });
        }

        return res.status(200).json({ gatewayUrl: sslData.GatewayPageURL });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error starting payment' });
    }
};
