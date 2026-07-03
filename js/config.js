// Firebase project: inventario-a814d
// Para actualizar: Firebase Console → Configuración del proyecto → Tus apps → Config
const firebaseConfig = {
  apiKey: "AIzaSyDqK7onevckU4llJMHStPmU2ErRU-hF8Q4",
  authDomain: "inventario-a814d.firebaseapp.com",
  projectId: "inventario-a814d",
  storageBucket: "inventario-a814d.firebasestorage.app",
  messagingSenderId: "750525909917",
  appId: "1:750525909917:web:93601df59feb8fd20d7d74"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Persistencia offline: las escrituras sobreviven si se cierra el navegador sin conexión
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
    console.warn('Firestore persistence error:', err.code);
  }
});
