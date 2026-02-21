const admin = require('firebase-admin');

// In a real production environment, you would use a service account key JSON file
// or inject it via environment variables correctly. 
// For this example, we parse it from env or just use standard default credentials.
try {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        if (process.env.FIREBASE_PRIVATE_KEY.includes('your-private-key')) {
            console.log('Firebase Admin: detected placeholder credentials. Skipping initialization for local dev mock mode.');
        } else {
            // Determine how the key was formatted and replace actual newline instances
            let privateKey = process.env.FIREBASE_PRIVATE_KEY;
            if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
                privateKey = privateKey.substring(1, privateKey.length - 1);
            }
            privateKey = privateKey.replace(/\\n/g, '\n');

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: privateKey
                })
            });
            console.log('Firebase Admin Initialized via Environment Variables.');
        }
    } else {
        // Fallback if no specific creds (useful in GCP environments like App Engine / Cloud Run)
        admin.initializeApp();
        console.log('Firebase Admin Initialized via Default Credentials.');
    }
} catch (error) {
    console.error('Firebase Admin Initialization Error:', error);
}

let db;
if (admin.apps.length > 0) {
    db = admin.firestore();
    db.settings({ preferRest: true }); // Bypass Node.js IPv6 gRPC DEADLINE_EXCEEDED bugs
} else {
    console.warn("Firebase not initialized! Using mock DB operations.");
    db = {
        collection: (name) => ({
            doc: () => ({
                set: async () => { },
                collection: () => ({ doc: () => ({}) })
            }),
            get: async () => [],
            orderBy: () => ({ limit: () => ({ get: async () => [] }) })
        }),
        batch: () => ({
            set: () => { },
            commit: async () => { }
        })
    };
}

module.exports = { admin, db };
