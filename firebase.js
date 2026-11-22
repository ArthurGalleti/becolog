// Becolog - Firebase Web SDK (compat)
// As coleções e documentos são criados automaticamente na primeira gravação.
const firebaseConfig = {
  apiKey: "AIzaSyCP_5oQU6PM1mkCqRvvWRsAwCfaXnuAkTg",
  authDomain: "banco-de-dados-c8010.firebaseapp.com",
  projectId: "banco-de-dados-c8010",
  storageBucket: "banco-de-dados-c8010.firebasestorage.app",
  messagingSenderId: "251018199901",
  appId: "1:251018199901:web:27a5624aa2d07724f89eb4",
  measurementId: "G-Q9SGG52ZTY"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
