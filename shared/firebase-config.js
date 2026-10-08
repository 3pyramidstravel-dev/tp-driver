/* ==========================================================================
   Firebase project settings for the Three Pyramids Driver Platform.
   Project: three-pyramids (three-pyramids-d8ce7) — web app "tp-driver".
   These values are public by design; security comes from firestore.rules.
   `self` works both in the pages and in the notifications service worker.
   ========================================================================== */
self.TP_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCc1PzGa1_I2--vLpVciixSWxmjzL6ZfxI',
  authDomain: 'three-pyramids-d8ce7.firebaseapp.com',
  projectId: 'three-pyramids-d8ce7',
  storageBucket: 'three-pyramids-d8ce7.firebasestorage.app',
  messagingSenderId: '1000045920935',
  appId: '1:1000045920935:web:1ef90a05e146dc15f1d182'
};
/* Web Push certificate (Firebase → Project settings → Cloud Messaging) — public key. */
self.TP_VAPID_KEY = 'BJuBrqj_Y_btlGveonMdMrtgzZj79mJ9jIriUveSrj5ESE4BYk7Izq_-QNttO1ZBUdRmE0sIvrnH5FUUiNYEkNI';
