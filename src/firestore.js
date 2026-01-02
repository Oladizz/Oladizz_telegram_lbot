const admin = require('firebase-admin');
const serviceAccount = require('../google-credentials.json');


// Initialize the Firebase Admin SDK with the service account credentials.
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Get the Firestore database instance
const db = admin.firestore();

module.exports = db;
