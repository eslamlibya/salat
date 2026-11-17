/* إعدادات مشروع Firebase
 * اتركها null ليعمل المتجر محلياً (البيانات في متصفح الجهاز فقط).
 * لربط المتجر بقاعدة البيانات: الصق إعدادات تطبيق الويب من
 * Firebase Console ← Project settings ← Your apps ← SDK setup and configuration ← Config
 * (هذه الإعدادات ليست سرية، والحماية تتم عبر قواعد firestore.rules)
 */
window.ALAFA_FIREBASE = null;

/* إعدادات مشروع alafa-store — يكتمل الربط بعد إضافة apiKey و appId ثم حذف علامتي التعليق حول الكائن */
/*
window.ALAFA_FIREBASE = {
  apiKey: "",
  authDomain: "alafa-store.firebaseapp.com",
  projectId: "alafa-store",
  storageBucket: "alafa-store.firebasestorage.app",
  messagingSenderId: "1097990305369",
  appId: ""
};
*/

/* مثال:
window.ALAFA_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "alafa-store.firebaseapp.com",
  projectId: "alafa-store",
  storageBucket: "alafa-store.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
*/
