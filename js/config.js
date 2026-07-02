// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE FIREBASE
// Copia estos valores desde la Consola de Firebase:
//   → Configuración del proyecto (ícono ⚙️) → Tus apps → Configuración del SDK
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROJECT_ID.firebaseapp.com",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_PROJECT_ID.appspot.com",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId:             "TU_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
