# خادم حسابات «الصلاة»

Cloudflare Worker + قاعدة D1. يوفّر: إنشاء حساب (اسم، اسم مستخدم، بريد، كلمة مرور)، تأكيد البريد برمز من 6 أرقام، الدخول، نسيان كلمة المرور، مزامنة بيانات التطبيق، حذف الحساب.

## النشر (من Cloudflare Dashboard)
1. Workers & Pages ← Create ← Worker، سمِّه **salat-account** (الاسم مهم لأن التطبيق يتصل بـ `autumn-frost-d70c.vzftysb4h2.workers.dev`).
2. Edit code ← الصق محتوى `worker.js` ← Deploy.
3. Storage & databases ← D1 ← Create database (مثلًا `salat-account`).
4. في الـ Worker: Settings ← Bindings ← Add ← D1 database، الاسم **DB**، واختر القاعدة.
5. Settings ← Variables and Secrets:
   - `MAIL_FROM` (Text): بريدك الذي وثّقته في Brevo كمرسِل.
   - `BREVO_KEY` (Secret): مفتاح API من Brevo. لا تضعه في GitHub أو المحادثة أبدًا.
6. افتح `https://autumn-frost-d70c.vzftysb4h2.workers.dev/` فيجب أن تظهر `{"ok":true,"name":"salat-account"}`.

## Brevo (إرسال البريد مجانًا)
1. أنشئ حسابًا في brevo.com.
2. Senders & IP ← Senders ← أضف بريدك ووثّقه.
3. SMTP & API ← API Keys ← أنشئ مفتاحًا.

## الأمان
- كلمات المرور: PBKDF2-SHA256 مع ملح عشوائي، 100 ألف دورة.
- رموز التأكيد: صالحة 15 دقيقة، 5 محاولات، تُخزَّن مجزّأة.
- حدود محاولات لكل IP ولكل حساب.
- جلسات عشوائية تُخزَّن مجزّأة وتنتهي بعد 60 يومًا.

## النشر الموحّد (الأسهل)
الملف `combined-worker.js` يجمع الإشعارات والحسابات في Worker واحد، ويُنشر فوق الـ Worker الحالي `salat-push` الذي يملك ربط D1 جاهزًا. أضف إليه المتغيرين `MAIL_FROM` و`BREVO_KEY` فقط.
