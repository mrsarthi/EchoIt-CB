const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin for Push Notifications
let fcmReady = false;
try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        // Look for the key in the same directory (server/)
        serviceAccount = require('./serviceAccountKey.json');
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        fcmReady = true;
        console.log('[PushBuffer] Firebase Admin initialized successfully.');
    }
} catch (err) {
    console.error('[PushBuffer] Firebase Initialization Error:', err.message);
}

/**
 * Internal Endpoint to Trigger Push Notifications
 * Expects: { pushToken, title, body, data }
 */
app.post('/push', async (req, res) => {
    if (!fcmReady) {
        return res.status(503).json({ error: 'FCM service not ready' });
    }

    const { pushToken, title, body, data } = req.body;

    if (!pushToken) {
        return res.status(400).json({ error: 'Missing pushToken' });
    }

    try {
        await admin.messaging().send({
            token: pushToken,
            notification: { title, body },
            android: { priority: 'high' },
            data: data || {}
        });
        console.log(`[PushBuffer] Push sent successfully to token ${pushToken.slice(0, 10)}...`);
        res.json({ success: true });
    } catch (err) {
        console.error('[PushBuffer] Push Failed:', err.message);
        res.status(500).json({ error: err.message, code: err.code });
    }
});

const PORT = process.env.PUSH_BUFFER_PORT || 3002;
app.listen(PORT, () => {
    console.log(`🚀 Push Buffer Microservice running on port ${PORT}`);
});
