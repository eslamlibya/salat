/* ALAFA — ربط المتجر بقاعدة بيانات Firebase (Firestore + Authentication)
 * يُحمَّل تلقائياً من data.js عند ملء firebase-config.js
 *
 * هيكل قاعدة البيانات:
 *   settings/store       إعدادات المتجر (قراءة عامة)
 *   categories/{id}      الأقسام (قراءة عامة)
 *   products/{id}        المنتجات (قراءة عامة)
 *   orders/{id}          الطلبات (العميل ينشئ فقط، المدير يقرأ ويعدّل)
 *   admins/{uid}         حسابات المدراء (تُضاف يدوياً من Firebase Console)
 */
const V = "10.12.2";
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);
const au = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);

const ERRORS = {
  "permission-denied": "ليس لديك صلاحية لهذه العملية",
  "unavailable": "لا يوجد اتصال بالإنترنت، حاول مجدداً",
  "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
  "auth/wrong-password": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
  "auth/user-not-found": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
  "auth/invalid-email": "البريد الإلكتروني غير صالح",
  "auth/too-many-requests": "محاولات كثيرة، انتظر قليلاً ثم حاول",
  "auth/network-request-failed": "لا يوجد اتصال بالإنترنت"
};
function friendly(e) {
  const err = new Error(ERRORS[e && e.code] || (e && e.message) || "حدث خطأ غير متوقع");
  err.code = e && e.code;
  return err;
}

export function create(cfg, A) {
  const app = initializeApp(cfg);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  const auth = au.getAuth(app);

  /* للتجربة المحلية عبر Firebase Emulator */
  if (cfg.emulator) {
    fs.connectFirestoreEmulator(db, cfg.emulator.host || "localhost", cfg.emulator.firestorePort || 8080);
    au.connectAuthEmulator(auth, `http://${cfg.emulator.host || "localhost"}:${cfg.emulator.authPort || 9099}`, { disableWarnings: true });
  }

  const ref = (col, id) => fs.doc(db, col, id);
  const rows = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  let ordersUnsub = null;

  function listen() {
    let pending = 3;
    return new Promise((resolve) => {
      const done = () => { if (--pending === 0) { A.loaded = true; resolve(); } A.emit(); };
      const once = (fn) => { let first = true; return (snap) => { fn(snap); if (first) { first = false; done(); } else A.emit(); }; };
      const fail = (name) => (e) => { console.error(name, e); A.firebaseError = friendly(e); if (!A.loaded) done(); else A.emit(); };

      fs.onSnapshot(ref("settings", "store"), once((s) => {
        A.db.settings = Object.assign({}, A.DEFAULT.settings, s.exists() ? s.data() : {});
        delete A.db.settings.adminPin;
      }), fail("settings"));
      fs.onSnapshot(fs.collection(db, "categories"), once((s) => { A.db.categories = rows(s); }), fail("categories"));
      fs.onSnapshot(fs.collection(db, "products"), once((s) => { A.db.products = rows(s); }), fail("products"));
    });
  }

  function listenOrders() {
    if (ordersUnsub) return;
    ordersUnsub = fs.onSnapshot(fs.collection(db, "orders"),
      (s) => { A.db.orders = rows(s); A.emit(); },
      (e) => { console.error("orders", e); A.firebaseError = friendly(e); A.emit(); });
  }
  function stopOrders() { if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; } A.db.orders = []; }

  /* حالة المدير: مسجّل دخول + موجود في مجموعة admins */
  let authReady;
  const authKnown = new Promise((r) => { authReady = r; });
  au.onAuthStateChanged(auth, async (user) => {
    let admin = false;
    if (user) {
      try { admin = (await fs.getDoc(ref("admins", user.uid))).exists(); } catch (e) { admin = false; }
    }
    A.isAdmin = admin;
    A.adminEmail = user ? user.email : "";
    A.adminUid = user ? user.uid : "";
    if (admin) listenOrders(); else stopOrders();
    authReady();
    A.emit();
  });

  return {
    start: () => Promise.all([listen(), authKnown]),

    write(ops) {
      const b = fs.writeBatch(db);
      ops.forEach((op) => {
        const r = ref(op.col, op.id);
        if (op.t === "put") b.set(r, op.data, op.col === "settings" ? { merge: true } : undefined);
        else if (op.t === "patch") b.update(r, op.data);
        else if (op.t === "del") b.delete(r);
        else if (op.t === "inc") b.update(r, { [op.field]: fs.increment(op.n) });
      });
      return b.commit().catch((e) => { throw friendly(e); });
    },

    async getOrders(ids) {
      const out = [];
      for (const id of ids.slice(0, 30)) {
        try {
          const s = await fs.getDoc(ref("orders", id));
          if (s.exists()) out.push(Object.assign({ id: s.id }, s.data()));
        } catch (e) { /* طلب محذوف أو غير متاح */ }
      }
      return out;
    },

    async login(email, password) {
      let cred;
      try { cred = await au.signInWithEmailAndPassword(auth, String(email).trim(), password); }
      catch (e) { throw friendly(e); }
      const s = await fs.getDoc(ref("admins", cred.user.uid)).catch(() => null);
      if (!s || !s.exists()) {
        const uidShown = cred.user.uid;
        await au.signOut(auth);
        const err = new Error("هذا الحساب ليس مديراً. أضف مستنداً بالمعرّف " + uidShown + " إلى مجموعة admins في Firebase Console.");
        err.code = "not-admin"; err.uid = uidShown;
        throw err;
      }
    },

    logout: () => au.signOut(auth),
    restoreSession() {}
  };
}
