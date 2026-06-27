require('dotenv').config();

// Placeholder for Firebase Admin SDK initialization
let firebaseAdmin = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const admin = require('firebase-admin');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseAdmin = admin;
    console.log("Firebase Admin SDK initialized successfully.");
  } else {
    console.log("Firebase credentials not found in env. Silent push notifications will run in mock mode.");
  }
} catch (err) {
  console.error("Failed to initialize Firebase Admin SDK. Falling back to mock mode:", err.message);
}

/**
 * Dispatches a silent FCM background wakeup notification to a recipient client.
 * @param {string} address Recipient Ethereum wallet address
 * @param {string} pushToken Encrypted/decrypted push token stored in PostgreSQL
 */
async function sendSilentPushNotification(address, pushToken) {
  if (!pushToken) {
    console.log(`[PUSH] Skip: No push token registered for ${address}`);
    return false;
  }

  // Silent payload: data-only payload triggers background fetch on Android and iOS
  const message = {
    data: {
      type: 'NEW_MESSAGE_ALERT'
    },
    token: pushToken
  };

  if (firebaseAdmin) {
    try {
      const response = await firebaseAdmin.messaging().send(message);
      console.log(`[PUSH] Silent notification sent successfully to ${address}:`, response);
      return true;
    } catch (err) {
      console.error(`[PUSH] Failed to dispatch silent notification to ${address}:`, err.message);
      return false;
    }
  } else {
    // Mock mode
    console.log(`[PUSH MOCK] Dispatching silent FCM wakeup notification for ${address} to token: ${pushToken}`);
    return true;
  }
}

module.exports = {
  sendSilentPushNotification
};
