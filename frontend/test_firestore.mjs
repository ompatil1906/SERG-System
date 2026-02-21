import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

console.log("Using config:", { ...firebaseConfig, apiKey: "***" });

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testFetch() {
    try {
        console.log("Attempting to fetch devices...");
        const snapshot = await getDocs(collection(db, "devices"));
        console.log(`Success! Found ${snapshot.size} device documents.`);
        snapshot.forEach(doc => {
            console.log(doc.id, "=>", doc.data());
        });
        process.exit(0);
    } catch (error) {
        console.error("Firestore Web SDK Error:", error);
        process.exit(1);
    }
}

testFetch();
