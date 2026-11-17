# ALAFA — متجر شركة ألفا الطبية

تطبيق متجر (PWA) لشركة **ALAFA HEALTHCARE** لاستيراد وتسويق الأدوية، مع لوحة تحكم لإدارة المتجر.

## الملفات
| الملف | الوصف |
|---|---|
| `index.html` | واجهة المتجر للعملاء: الأقسام، البحث، السلة، إتمام الطلب، طلباتي، تواصل |
| `admin.html` | لوحة التحكم: إحصائيات، الطلبات، المنتجات، الأقسام، العملاء، الإعدادات |
| `data.js` | طبقة البيانات المشتركة (localStorage) والبيانات التجريبية |
| `style.css` | التصميم المشترك بألوان الشعار |
| `manifest.webmanifest`, `sw.js` | تثبيت التطبيق على الجوال والعمل بدون إنترنت |

## التشغيل
افتح `alafa/index.html` عبر أي خادم ويب (مثلاً GitHub Pages أو `python3 -m http.server`).
- لوحة التحكم: `alafa/admin.html` — الرمز الافتراضي **1234** (غيّره من الإعدادات).
- عدّل رقم واتساب الشركة من الإعدادات لاستقبال الطلبات.

| `firebase-config.js` | إعدادات مشروع Firebase (فارغ = الوضع المحلي) |
| `firebase-backend.js` | ربط Firestore وتسجيل دخول المدير |
| `firestore.rules`, `firebase.json` | قواعد الحماية وإعدادات الاستضافة على Firebase |

## وضعا التشغيل
- **محلي** (افتراضي): البيانات في متصفح الجهاز فقط، والدخول للوحة برمز سري (1234).
- **Firebase**: قاعدة بيانات سحابية مشتركة؛ تظهر طلبات كل العملاء في لوحة التحكم فوراً،
  والدخول ببريد وكلمة مرور المدير.

## ربط المتجر بـ Firebase (مرة واحدة)
1. أنشئ مشروعاً في https://console.firebase.google.com (الخطة المجانية Spark تكفي).
2. **Build → Firestore Database → Create database** (اختر موقعاً قريباً مثل `eur3`، وابدأ بـ Production mode).
3. **Build → Authentication → Get started → Email/Password → Enable**،
   ثم من تبويب **Users → Add user** أنشئ حساب المدير (بريد + كلمة مرور) وانسخ **User UID**.
4. في **Firestore → Start collection** أنشئ مجموعة اسمها `admins`، ومستنداً **معرّفه = User UID**
   (أضف أي حقل، مثلاً `email`). هذا ما يمنح الحساب صلاحية المدير.
5. في **Firestore → Rules** الصق محتوى `firestore.rules` واضغط **Publish**.
6. **Project settings → Your apps → Web (</>)**: سجّل تطبيقاً وانسخ كائن `firebaseConfig`
   والصقه في `firebase-config.js` بدلاً من `null`.
7. افتح `admin.html`، سجّل الدخول، واضغط «تحميل المنتجات التجريبية» أو أضف منتجاتك.
   لنقل بيانات الوضع المحلي: صدّر نسخة احتياطية قبل الربط ثم استخدم «استعادة / نقل البيانات».

### النشر على Firebase Hosting (اختياري)
```bash
npm install -g firebase-tools
firebase login
cd alafa
firebase use --add            # اختر مشروعك
firebase deploy               # ينشر الموقع وقواعد Firestore معاً
```
سيعمل المتجر على `https://<project-id>.web.app` ولوحة التحكم على `/admin.html`.

### التجربة المحلية بالمحاكي
```bash
firebase emulators:start --only auth,firestore --project demo-alafa
```
وأضف إلى `firebase-config.js` الحقل `emulator: { host: "127.0.0.1" }`.

## كيف يعمل المخزون والطلبات في Firebase
- العميل يُنشئ الطلب فقط ولا يستطيع رؤية طلبات غيره أو تعديل المنتجات (قواعد `firestore.rules`).
- يُخصم المخزون عند تغيير المدير حالة الطلب إلى «مؤكد» أو «قيد التوصيل» أو «تم التسليم»،
  ويُعاد عند الإلغاء.
- الصور تُصغَّر تلقائياً وتُحفظ داخل مستند المنتج (لا حاجة لخدمة Storage المدفوعة).
- المجموع يحسبه متصفح العميل؛ راجع الأسعار في الطلب قبل تأكيده.
