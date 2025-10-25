// Force Firestore to use long-polling and disable fetch streams in environments
// where streaming WebChannel connections are blocked (proxies, certain firewalls, or extensions).
// These globals must be set before the Firebase SDK is initialized.
try {
  // eslint-disable-next-line no-undef
  if (typeof window !== 'undefined') {
    // Force long polling
    window.__FIREBASE_FIRESTORE_FORCE_LONG_POLLING = true;
    // Disable fetch streams
    window.__FIREBASE_FIRESTORE_USE_FETCH_STREAMS = false;
  }
} catch (e) {
  // ignore in non-browser environments
}

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAygH4SqLooeLlVfQJqmPzywAqHcrjZ9lA",
  authDomain: "prepmind-bb3b1.firebaseapp.com",
  projectId: "prepmind-bb3b1",
  storageBucket: "prepmind-bb3b1.firebasestorage.app",
  messagingSenderId: "594883985184",
  appId: "1:594883985184:web:e519acb3bab4de9fbae145",
  measurementId: "G-WH5GWGF50R"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Workaround for environments where WebChannel / streaming RPCs are blocked
// (firewalls, proxies, some corporate networks, or browser extensions).
// Force long-polling and disable fetch streams to avoid "Listen" transport errors.
let db;
try {
  // initializeFirestore allows passing settings on init
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false
  });
} catch (e) {
  // Fallback if initializeFirestore is not available for any reason
  db = getFirestore(app);
}

export { db };
