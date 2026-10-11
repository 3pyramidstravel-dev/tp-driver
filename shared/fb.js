/* ==========================================================================
   Firebase loader + a small, path-based wrapper.
   Loaded with dynamic import() so pages also work when opened from a file
   or inside the Android WebView.
   ========================================================================== */
(function (TP) {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let A, F, auth, db;

  const fb = TP.fb = { loaded: false };

  fb.configured = function () {
    const c = window.TP_FIREBASE_CONFIG || {};
    return !!(c.apiKey && c.projectId && !/PASTE/.test(c.apiKey + c.projectId));
  };

  let loading = null;
  fb.load = function () {
    if (loading) return loading;
    loading = (async () => {
      // the customer page reads its one trip by its secret link — it does not sign in
      const [appMod, authMod, fsMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        fb.noAuth ? null : import(SDK + 'firebase-auth.js'),
        import(SDK + 'firebase-firestore.js')
      ]);
      A = authMod; F = fsMod;
      const app = fb.app = appMod.initializeApp(window.TP_FIREBASE_CONFIG);
      if (A) {
        auth = A.getAuth(app);
        try { await A.setPersistence(auth, A.browserLocalPersistence); } catch (e) { /* default persistence */ }
      }
      // Driver phones keep a local copy and queue presses made without internet (sent when it returns).
      db = null;
      if (fb.offline && F.initializeFirestore && F.persistentLocalCache) {
        try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
        catch (e) { console.warn('offline cache unavailable', e); db = null; }
      }
      if (!db) db = F.getFirestore(app);
      fb.loaded = true;
      return fb;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  };

  /* ---------- push notifications (wake-up alarm, supervisor bells) ---------- */
  let M = null, messaging = null, swReg;
  /** Is web push possible on this phone/browser? */
  fb.pushSupported = async function () {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
    try { M = M || await import(SDK + 'firebase-messaging.js'); return await M.isSupported(); } catch (e) { return false; }
  };
  /** Returns this device's push token (asks for permission only when `ask`). Foreground messages → 'tp:push'. */
  fb.pushToken = async function (ask) {
    if (!(await fb.pushSupported())) return null;
    if (Notification.permission !== 'granted') {
      if (!ask) return null;
      if ((await Notification.requestPermission()) !== 'granted') return null;
    }
    if (swReg === undefined) { try { swReg = await navigator.serviceWorker.register(TP.siteUrl('firebase-messaging-sw.js')); } catch (e) { console.warn('service worker', e); swReg = null; } }
    if (!messaging) {
      messaging = M.getMessaging(fb.app);
      M.onMessage(messaging, p => document.dispatchEvent(new CustomEvent('tp:push', { detail: p })));
    }
    const opts = { vapidKey: self.TP_VAPID_KEY };
    if (swReg) opts.serviceWorkerRegistration = swReg;
    return M.getToken(messaging, opts);
  };

  /* ---------- auth ---------- */
  fb.onAuth = cb => A.onAuthStateChanged(auth, cb);
  fb.user = () => auth && auth.currentUser;
  fb.signInAnon = () => A.signInAnonymously(auth);
  fb.signOut = () => A.signOut(auth);

  /* ---------- firestore ---------- */
  const ref = path => F.doc(db, path);
  const col = path => F.collection(db, path);
  fb.ts = () => F.serverTimestamp();
  fb.del = () => F.deleteField();
  /** Adds to a number on the server (safe when two phones write at once, or a write waited offline). */
  fb.inc = n => F.increment(n);
  /** This sign-in's ID token (for the cloud alarm's own services, e.g. translation). */
  fb.idToken = () => auth && auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
  fb.newDocId = colPath => F.doc(col(colPath)).id;

  fb.get = async path => { const s = await F.getDoc(ref(path)); return s.exists() ? Object.assign({ id: s.id }, s.data()) : null; };
  fb.set = (path, data, merge) => F.setDoc(ref(path), data, merge ? { merge: true } : undefined);
  fb.update = (path, data) => F.updateDoc(ref(path), data);
  fb.remove = path => F.deleteDoc(ref(path));
  fb.add = async (colPath, data) => { const r = F.doc(col(colPath)); await F.setDoc(r, data); return r.id; };

  function buildQuery(colPath, opts) {
    opts = opts || {};
    const parts = [];
    (opts.where || []).forEach(([f, op, v]) => parts.push(F.where(f, op, v)));
    if (opts.orderBy) parts.push(F.orderBy(opts.orderBy[0], opts.orderBy[1] || 'asc'));
    if (opts.limit) parts.push(F.limit(opts.limit));
    return parts.length ? F.query(col(colPath), ...parts) : col(colPath);
  }
  fb.list = async (colPath, opts) => {
    const s = await F.getDocs(buildQuery(colPath, opts));
    return s.docs.map(d => Object.assign({ id: d.id }, d.data()));
  };
  fb.onDoc = (path, cb, err) => F.onSnapshot(ref(path), s => cb(s.exists() ? Object.assign({ id: s.id }, s.data()) : null), err || (e => console.error(path, e)));
  fb.onCol = (colPath, opts, cb, err) => F.onSnapshot(buildQuery(colPath, opts),
    s => cb(s.docs.map(d => Object.assign({ id: d.id }, d.data()))), err || (e => console.error(colPath, e)));

  /** Atomic multi-document write: [{op:'set'|'update'|'delete', path, data, merge}] */
  fb.batch = function (ops) {
    const b = F.writeBatch(db);
    ops.forEach(o => {
      if (o.op === 'delete') b.delete(ref(o.path));
      else if (o.op === 'update') b.update(ref(o.path), o.data);
      else b.set(ref(o.path), o.data, o.merge ? { merge: true } : undefined);
    });
    return b.commit();
  };
})(window.TP = window.TP || {});
