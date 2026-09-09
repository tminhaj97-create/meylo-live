// /api/payment-cancel.js
const admin = require('firebase-admin');
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
}

module.exports = async (req, res) => {
    const tranId = (req.body || {}).tran_id;
    if (tranId) {
        try {
            await admin.database().ref(`orders/${tranId}/status`).set('cancelled');
        } catch (err) { /* non-fatal */ }
    }
    res.writeHead(302, { Location: '/?payment=cancelled' });
    res.end();
};
