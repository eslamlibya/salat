/* ALAFA — طبقة البيانات المشتركة بين المتجر ولوحة التحكم
 * تعمل بوضعين:
 *   - local    : التخزين في متصفح الجهاز (عند عدم وجود إعدادات Firebase)
 *   - firebase : قاعدة بيانات Firestore مع تسجيل دخول المدير عبر Firebase Auth
 * الصفحات تستخدم نفس الواجهة في الوضعين: ALAFA.ready / ALAFA.onChange / ALAFA.saveProduct ...
 */
(function () {
  var KEY = "alafa-db-v1";

  var DEFAULT = {
    settings: {
      name: "ALAFA HEALTHCARE",
      nameAr: "شركة ألفا الطبية",
      tagline: "استيراد وتسويق الأدوية والمستلزمات الطبية",
      whatsapp: "218910000000",
      phone: "+218 91 000 0000",
      email: "info@alafa.ly",
      address: "طرابلس، ليبيا",
      currency: "د.ل",
      deliveryFee: 10,
      freeDeliveryOver: 300,
      adminPin: "1234",
      announcement: "توصيل لجميع المدن — اطلب الآن واستلم خلال 48 ساعة"
    },
    categories: [
      { id: "c1", name: "أدوية", icon: "💊", sort: 1 },
      { id: "c2", name: "فيتامينات ومكملات", icon: "🍊", sort: 2 },
      { id: "c3", name: "مستلزمات طبية", icon: "🩺", sort: 3 },
      { id: "c4", name: "العناية الشخصية", icon: "🧴", sort: 4 },
      { id: "c5", name: "الأم والطفل", icon: "🍼", sort: 5 }
    ],
    products: [
      { id: "p1", name: "باراسيتامول 500 ملغ", brand: "ALAFA Pharma", cat: "c1", price: 6, oldPrice: 0, stock: 240, unit: "علبة 20 قرص", desc: "مسكن للألم وخافض للحرارة.", rx: false, featured: true, img: "", active: true, created: 8 },
      { id: "p2", name: "أموكسيسيلين 500 ملغ", brand: "ALAFA Pharma", cat: "c1", price: 18, oldPrice: 0, stock: 80, unit: "علبة 16 كبسولة", desc: "مضاد حيوي واسع الطيف. يُصرف بوصفة طبية.", rx: true, featured: false, img: "", active: true, created: 7 },
      { id: "p3", name: "فيتامين C 1000 ملغ", brand: "VitaPlus", cat: "c2", price: 25, oldPrice: 32, stock: 120, unit: "20 قرص فوار", desc: "لدعم المناعة.", rx: false, featured: true, img: "", active: true, created: 6 },
      { id: "p4", name: "أوميغا 3", brand: "VitaPlus", cat: "c2", price: 45, oldPrice: 0, stock: 60, unit: "60 كبسولة", desc: "زيت السمك لصحة القلب.", rx: false, featured: true, img: "", active: true, created: 5 },
      { id: "p5", name: "جهاز قياس الضغط الرقمي", brand: "MediCheck", cat: "c3", price: 150, oldPrice: 180, stock: 15, unit: "جهاز", desc: "قياس دقيق لضغط الدم ونبض القلب.", rx: false, featured: true, img: "", active: true, created: 4 },
      { id: "p6", name: "كمامات طبية", brand: "SafeCare", cat: "c3", price: 12, oldPrice: 0, stock: 500, unit: "علبة 50 قطعة", desc: "ثلاث طبقات.", rx: false, featured: false, img: "", active: true, created: 3 },
      { id: "p7", name: "واقي شمس SPF50", brand: "DermaSun", cat: "c4", price: 55, oldPrice: 0, stock: 40, unit: "50 مل", desc: "حماية عالية للبشرة.", rx: false, featured: false, img: "", active: true, created: 2 },
      { id: "p8", name: "حليب أطفال المرحلة 1", brand: "BabyNutri", cat: "c5", price: 38, oldPrice: 0, stock: 70, unit: "400 غ", desc: "من الولادة حتى 6 أشهر.", rx: false, featured: false, img: "", active: true, created: 1 }
    ],
    orders: []
  };

  var STATUSES = { new: "جديد", confirmed: "مؤكد", shipping: "قيد التوصيل", delivered: "تم التسليم", cancelled: "ملغي" };
  /* الحالات التي يُخصم فيها المخزون */
  var DEDUCT = { confirmed: 1, shipping: 1, delivered: 1 };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(p) {
    var a = new Uint8Array(10); (window.crypto || window.msCrypto).getRandomValues(a);
    return (p || "") + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(36)).slice(-2); }).join("");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var A = window.ALAFA = {
    KEY: KEY, DEFAULT: DEFAULT, STATUSES: STATUSES,
    db: { settings: clone(DEFAULT.settings), categories: [], products: [], orders: [] },
    mode: "local", loaded: false, isAdmin: false, uid: uid, esc: esc
  };

  /* ---------- الاشتراك في التغييرات ---------- */
  var subs = [];
  A.onChange = function (fn) {
    subs.push(fn);
    if (A.loaded) { try { fn(A.db); } catch (e) { console.error(e); } }
  };
  A.emit = function () {
    sortAll();
    subs.forEach(function (fn) { try { fn(A.db); } catch (e) { console.error(e); } });
  };
  function sortAll() {
    A.db.categories.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    A.db.products.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    A.db.orders.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  /* ---------- الوضع المحلي ---------- */
  function localBackend() {
    function load() {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) {
          var d = JSON.parse(raw);
          return {
            settings: Object.assign({}, DEFAULT.settings, d.settings || {}),
            categories: d.categories || [], products: d.products || [], orders: d.orders || []
          };
        }
      } catch (e) {}
      return clone(DEFAULT);
    }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(A.db)); }
      catch (e) { throw new Error("تعذر الحفظ: مساحة التخزين ممتلئة. جرّب صوراً أصغر."); }
    }
    function arr(col) { return A.db[col]; }
    function apply(op) {
      if (op.col === "settings") {
        if (op.t === "put") A.db.settings = Object.assign({}, A.db.settings, op.data);
        return;
      }
      var list = arr(op.col), i = list.findIndex(function (x) { return x.id === op.id; });
      if (op.t === "put") { var d = Object.assign({}, op.data, { id: op.id }); if (i >= 0) list[i] = d; else list.push(d); }
      else if (op.t === "patch") { if (i >= 0) Object.assign(list[i], op.data); }
      else if (op.t === "del") { if (i >= 0) list.splice(i, 1); }
      else if (op.t === "inc") { if (i >= 0) list[i][op.field] = Math.max(0, Number(list[i][op.field] || 0) + op.n); }
    }
    window.addEventListener("storage", function (e) {
      if (e.key === KEY) { A.db = load(); A.emit(); }
    });
    return {
      start: function () { A.db = load(); A.loaded = true; A.emit(); return Promise.resolve(); },
      write: function (ops) {
        var backup = JSON.stringify(A.db);
        try { ops.forEach(apply); persist(); }
        catch (e) { A.db = JSON.parse(backup); return Promise.reject(e); }
        A.emit(); return Promise.resolve();
      },
      getOrders: function (ids) {
        return Promise.resolve(A.db.orders.filter(function (o) { return ids.indexOf(o.id) >= 0; }));
      },
      login: function (pin) {
        if (String(pin) !== String(A.db.settings.adminPin)) return Promise.reject(new Error("الرمز غير صحيح"));
        try { sessionStorage.setItem("alafa-admin", "1"); } catch (e) {}
        A.isAdmin = true; A.emit(); return Promise.resolve();
      },
      logout: function () { try { sessionStorage.removeItem("alafa-admin"); } catch (e) {} A.isAdmin = false; A.emit(); return Promise.resolve(); },
      restoreSession: function () { try { A.isAdmin = sessionStorage.getItem("alafa-admin") === "1"; } catch (e) {} }
    };
  }

  /* ---------- اختيار الوضع ---------- */
  var backend;
  A.ready = (function () {
    var cfg = window.ALAFA_FIREBASE;
    if (cfg && cfg.projectId) {
      A.mode = "firebase";
      return import("./firebase-backend.js")
        .then(function (m) { backend = m.create(cfg, A); return backend.start(); })
        .catch(function (e) {
          console.error("Firebase:", e);
          A.firebaseError = e;
          A.loaded = true; A.emit();
        });
    }
    backend = localBackend();
    backend.restoreSession();
    return backend.start();
  })();

  function write(ops) {
    if (!backend) return Promise.reject(new Error("الاتصال بقاعدة البيانات غير متاح"));
    return backend.write(ops);
  }
  function find(col, id) { return A.db[col].find(function (x) { return x.id === id; }); }

  /* ---------- العمليات ---------- */
  A.saveProduct = function (p) {
    var id = p.id || uid("p"), d = Object.assign({}, p); delete d.id;
    if (!d.created) d.created = Date.now();
    return write([{ t: "put", col: "products", id: id, data: d }]).then(function () { return id; });
  };
  A.deleteProduct = function (id) { return write([{ t: "del", col: "products", id: id }]); };

  A.saveCategory = function (c) {
    var id = c.id || uid("c"), d = Object.assign({}, c); delete d.id;
    if (!d.sort) d.sort = Date.now();
    return write([{ t: "put", col: "categories", id: id, data: d }]);
  };
  A.deleteCategory = function (id) { return write([{ t: "del", col: "categories", id: id }]); };

  A.saveSettings = function (s) {
    var d = Object.assign({}, s);
    if (A.mode === "firebase") delete d.adminPin; /* الإعدادات عامة في Firebase، والدخول عبر البريد وكلمة المرور */
    return write([{ t: "put", col: "settings", id: "store", data: d }]);
  };

  function stockOps(order, sign) {
    return order.items.filter(function (i) { return find("products", i.id); })
      .map(function (i) { return { t: "inc", col: "products", id: i.id, field: "stock", n: sign * i.qty }; });
  }

  /* إنشاء طلب من المتجر. في الوضع المحلي يُخصم المخزون فوراً،
   * وفي Firebase يُخصم عند تأكيد المدير للطلب (العميل لا يملك صلاحية تعديل المنتجات). */
  A.placeOrder = function (o) {
    var order = Object.assign({}, o, {
      id: uid(""), code: "ALF-" + String(Date.now()).slice(-6),
      date: new Date().toISOString(), status: "new", stockApplied: A.mode === "local"
    });
    var data = Object.assign({}, order); delete data.id;
    var ops = [{ t: "put", col: "orders", id: order.id, data: data }];
    if (A.mode === "local") ops = ops.concat(stockOps(order, -1));
    return write(ops).then(function () { return order; });
  };

  A.setOrderStatus = function (id, status) {
    var o = find("orders", id); if (!o) return Promise.reject(new Error("الطلب غير موجود"));
    var patch = { status: status }, ops = [];
    if (DEDUCT[status] && !o.stockApplied) { ops = stockOps(o, -1); patch.stockApplied = true; }
    if (status === "cancelled" && o.stockApplied) { ops = stockOps(o, 1); patch.stockApplied = false; }
    return write([{ t: "patch", col: "orders", id: id, data: patch }].concat(ops));
  };
  A.deleteOrder = function (id) { return write([{ t: "del", col: "orders", id: id }]); };

  A.getOrders = function (ids) { return backend ? backend.getOrders(ids) : Promise.resolve([]); };

  /* استيراد نسخة كاملة (استعادة نسخة احتياطية أو تحميل البيانات التجريبية) */
  A.importAll = function (data) {
    var ops = [{ t: "put", col: "settings", id: "store", data: Object.assign({}, A.db.settings, data.settings || {}) }];
    ["categories", "products", "orders"].forEach(function (col) {
      (data[col] || []).forEach(function (x) { var d = Object.assign({}, x); delete d.id; ops.push({ t: "put", col: col, id: x.id, data: d }); });
    });
    if (A.mode === "firebase") delete ops[0].data.adminPin;
    return write(ops);
  };
  A.seedDemo = function () { return A.importAll({ settings: DEFAULT.settings, categories: DEFAULT.categories, products: DEFAULT.products }); };
  A.resetLocal = function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };

  A.login = function (a, b) { return backend ? backend.login(a, b) : Promise.reject(new Error("قاعدة البيانات غير متصلة")); };
  A.logout = function () { return backend ? backend.logout() : Promise.resolve(); };

  /* ---------- أدوات العرض ---------- */
  A.money = function (n) {
    return (Math.round(Number(n || 0) * 100) / 100).toLocaleString("ar-LY") + " " + A.db.settings.currency;
  };
  A.catName = function (id) { var c = find("categories", id); return c ? c.name : "—"; };
  A.productImg = function (p) {
    if (p.img) return '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy">';
    var c = find("categories", p.cat);
    return '<span class="ph">' + (c ? esc(c.icon) : "💊") + "</span>";
  };

  /* يصغّر الصورة المرفوعة قبل تخزينها (تبقى داخل حد حجم مستند Firestore) */
  A.readImage = function (file, max) {
    max = max || 600;
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        var im = new Image();
        im.onload = function () {
          var s = Math.min(1, max / Math.max(im.width, im.height));
          var cv = document.createElement("canvas");
          cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
          var cx = cv.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          res(cv.toDataURL("image/jpeg", 0.8));
        };
        im.onerror = rej;
        im.src = r.result;
      };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  };
})();
