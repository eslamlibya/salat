/* ALAFA — طبقة البيانات المشتركة بين المتجر ولوحة التحكم (localStorage) */
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
      { id: "c1", name: "أدوية", icon: "💊" },
      { id: "c2", name: "فيتامينات ومكملات", icon: "🍊" },
      { id: "c3", name: "مستلزمات طبية", icon: "🩺" },
      { id: "c4", name: "العناية الشخصية", icon: "🧴" },
      { id: "c5", name: "الأم والطفل", icon: "🍼" }
    ],
    products: [
      { id: "p1", name: "باراسيتامول 500 ملغ", brand: "ALAFA Pharma", cat: "c1", price: 6, oldPrice: 0, stock: 240, unit: "علبة 20 قرص", desc: "مسكن للألم وخافض للحرارة.", rx: false, featured: true, img: "", active: true },
      { id: "p2", name: "أموكسيسيلين 500 ملغ", brand: "ALAFA Pharma", cat: "c1", price: 18, oldPrice: 0, stock: 80, unit: "علبة 16 كبسولة", desc: "مضاد حيوي واسع الطيف. يُصرف بوصفة طبية.", rx: true, featured: false, img: "", active: true },
      { id: "p3", name: "فيتامين C 1000 ملغ", brand: "VitaPlus", cat: "c2", price: 25, oldPrice: 32, stock: 120, unit: "20 قرص فوار", desc: "لدعم المناعة.", rx: false, featured: true, img: "", active: true },
      { id: "p4", name: "أوميغا 3", brand: "VitaPlus", cat: "c2", price: 45, oldPrice: 0, stock: 60, unit: "60 كبسولة", desc: "زيت السمك لصحة القلب.", rx: false, featured: true, img: "", active: true },
      { id: "p5", name: "جهاز قياس الضغط الرقمي", brand: "MediCheck", cat: "c3", price: 150, oldPrice: 180, stock: 15, unit: "جهاز", desc: "قياس دقيق لضغط الدم ونبض القلب.", rx: false, featured: true, img: "", active: true },
      { id: "p6", name: "كمامات طبية", brand: "SafeCare", cat: "c3", price: 12, oldPrice: 0, stock: 500, unit: "علبة 50 قطعة", desc: "ثلاث طبقات.", rx: false, featured: false, img: "", active: true },
      { id: "p7", name: "واقي شمس SPF50", brand: "DermaSun", cat: "c4", price: 55, oldPrice: 0, stock: 40, unit: "50 مل", desc: "حماية عالية للبشرة.", rx: false, featured: false, img: "", active: true },
      { id: "p8", name: "حليب أطفال المرحلة 1", brand: "BabyNutri", cat: "c5", price: 38, oldPrice: 0, stock: 70, unit: "400 غ", desc: "من الولادة حتى 6 أشهر.", rx: false, featured: false, img: "", active: true }
    ],
    orders: []
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        d.settings = Object.assign({}, DEFAULT.settings, d.settings || {});
        d.categories = d.categories || [];
        d.products = d.products || [];
        d.orders = d.orders || [];
        return d;
      }
    } catch (e) {}
    return clone(DEFAULT);
  }

  var db = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { alert("تعذر الحفظ: مساحة التخزين ممتلئة. جرّب صوراً أصغر."); }
  }

  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(n) {
    return (Math.round(Number(n || 0) * 100) / 100).toLocaleString("ar-LY") + " " + db.settings.currency;
  }

  function catName(id) {
    var c = db.categories.find(function (x) { return x.id === id; });
    return c ? c.name : "—";
  }

  function productImg(p) {
    if (p.img) return '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy">';
    var c = db.categories.find(function (x) { return x.id === p.cat; });
    return '<span class="ph">' + (c ? c.icon : "💊") + "</span>";
  }

  /* يصغّر الصورة المرفوعة قبل تخزينها */
  function readImage(file, max) {
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
  }

  function reset() { db = clone(DEFAULT); window.ALAFA.db = db; save(); }

  window.ALAFA = {
    KEY: KEY, db: db, save: save, uid: uid, esc: esc, money: money,
    catName: catName, productImg: productImg, readImage: readImage, reset: reset,
    reload: function () { db = load(); window.ALAFA.db = db; return db; },
    STATUSES: {
      new: "جديد", confirmed: "مؤكد", shipping: "قيد التوصيل", delivered: "تم التسليم", cancelled: "ملغي"
    }
  };
})();
