// Test Firebase connection
const admin = require("firebase-admin");

async function testFirebase() {
  try {
    // Initialize Firebase Admin SDK
    const serviceAccount = require('./config/prepmind-bb3b1-firebase-adminsdk-fbsvc-1e0638563c.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: "prepmind-bb3b1"
    });
    
    console.log("✅ Firebase Admin SDK initialized successfully");
    
    const db = admin.firestore();
    
    // Test Firestore connection
    const testCollection = db.collection('test');
    await testCollection.add({
      message: 'Firebase connection test',
      timestamp: new Date()
    });
    
    console.log("✅ Firestore write test successful");
    
    // Test read
    const snapshot = await testCollection.limit(1).get();
    console.log("✅ Firestore read test successful");
    console.log("📊 Document count:", snapshot.size);
    
    // Clean up test document
    const testDocs = await testCollection.get();
    testDocs.forEach(doc => doc.ref.delete());
    console.log("✅ Test cleanup completed");
    
  } catch (error) {
    console.error("❌ Firebase test failed:", error.message);
  }
}

testFirebase();

