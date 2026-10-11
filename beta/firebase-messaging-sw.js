/* Notifications service worker — shows the wake-up / supervisor alerts even when the app
   is closed, and opens the right page when tapped (Firebase handles both for messages that
   carry a "notification" part). Lives at the site root so it covers /driver/ and /control/. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('shared/firebase-config.js');
firebase.initializeApp(self.TP_FIREBASE_CONFIG);
firebase.messaging();
