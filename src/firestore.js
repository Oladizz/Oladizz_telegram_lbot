const admin = require('firebase-admin');

// Ensure dotenv is configured to load environment variables for local development
require('dotenv').config();

let serviceAccount;

// The primary way to provide credentials is via the FIREBASE_CREDENTIALS environment variable.
if (process.env.FIREBASE_CREDENTIALS) {
    try {
        // Parse the JSON string from the environment variable
        serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    } catch (e) {
        console.error('Error: Could not parse FIREBASE_CREDENTIALS. Make sure it is a valid JSON string.', e);
        process.exit(1); // Exit if credentials can't be parsed
    }
} else {
    // If the environment variable is not found, exit with an error.
    // This prevents the app from trying to run with incomplete or missing credentials.
    console.error('Error: FIREBASE_CREDENTIALS environment variable not set.');
    console.error('Please set the FIREBASE_CREDENTIALS environment variable with the content of your service account JSON file.');
    process.exit(1);
}

// Initialize the Firebase Admin SDK with the service account credentials.
try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
} catch (e) {
    console.error('Error: Could not initialize Firebase Admin SDK. Please check your service account credentials.', e);
    process.exit(1);
}

// Get the Firestore database instance
const db = admin.firestore();

module.exports = db;