# FADIL TRADING

منصة تعليم تداول مبنية بـ Node.js وExpress وMongoDB. تشمل صفحة ترحيبية عربية، حساب إدارة تلقائي، اختبارات مصححة من الخادم، متابعة الطلاب، اشتراكات، تذاكر دعم، ورفع محتوى آمن.

## تشغيل محلي

1. ثبّت Node.js 18 أو أحدث وMongoDB، أو أنشئ قاعدة Atlas.
2. انسخ الملف `cp .env.example .env` وعدّل `MONGO_URI` و`JWT_SECRET`. لا تضع بيانات MongoDB في ملف عام أو في Git.
3. شغّل `npm install` ثم `npm run dev`.
4. افتح `http://localhost:3000`.

عند ضبط `MONGO_URI` ينتظر الخادم اتصال MongoDB حتى 30 ثانية قبل فتح المنفذ، ثم ينشئ كورس **كورس مجاني** المنشور تلقائياً، ويختاره لكل طالب جديد، كما ينشئ أول حساب إداري: `admin` / `123456`. إن غاب المتغير أو فشل الاتصال، تظهر الواجهة مع تحذير لكن ميزات قاعدة البيانات لن تعمل. غيّر `ADMIN_PASSWORD` و`JWT_SECRET` في الإنتاج قبل أول تشغيل.

## ملف الاختبارات

الملف الكامل هو `data/quizzes.json`. يقرأه الخادم من القرص في كل طلب خاص بالاختبارات، لذلك تظهر التعديلات على الأسئلة والعناوين دون نسخها إلى كود الخادم أو إعادة تشغيله. حافظ على البنية التالية: لكل اختبار `id` فريد من حروف/أرقام/شرطات، و`title` و`questions`. ولكل سؤال `id` فريد و`text` و`options` (خياران على الأقل) و`correctAnswer` وهو رقم الخيار الصحيح يبدأ من `0`.

الأخبار مفعلة افتراضياً (`PUBLIC_NEWS_ENABLED=true`) ويمكن للإدارة إضافتها مع ملف قابل للتنزيل؛ تظهر للطلاب في لوحة المستخدم. أما الاختبارات فتبقى مغلقة للطلاب افتراضياً (`PUBLIC_QUIZZES_ENABLED=false`) لكن يمكن للإدارة رفع ملفها كاملاً من لوحة المحتوى، ثم تفعيلها لاحقاً عند الجاهزية.

## لوحة الإدارة والاشتراكات

- من تبويب **المحتوى والرفع** يستطيع الأدمن رفع ملف JSON كامل للاختبارات. يتحقق الخادم من معرّفات الاختبارات والأسئلة والخيارات والإجابة الصحيحة قبل استبدال `data/quizzes.json`.
- يستطيع الأدمن إضافة الكورسات والدروس وتعديلها أو حذفها. علّم الكورس بخيار **كورس مدفوع** ليُقفل على الطالب إلى أن يُقبل طلب اشتراكه.
- الدفع المعروض للطالب هو **التحويل عن طريق ماستر كارد — $100**. قبول طلب الطالب من تبويب **طلبات الاشتراك** يمنحه وصولاً إلى كل الكورسات المدفوعة.
- الأخبار تدعم نصاً ومرفقاً. ارفع المرفق أولاً من لوحة المحتوى، ثم ضع رابطه عند إنشاء الخبر؛ زر التنزيل يجبر تنزيل المرفقات المحلية داخل `uploads/`.

## رفع المشروع إلى GitHub

المجلد الحالي ليس مستودع Git مستقلّاً، لذلك نفّذ الأوامر التالية من داخل مجلد المشروع بعد استبدال `YOUR_GITHUB_USERNAME` باسم حسابك. لا تضف ملف `.env` أبداً:

```bash
git init
git branch -M main
git add server.js public package.json package-lock.json data README.md .env.example .gitignore Procfile render.yaml vercel.json uploads/.gitkeep
git commit -m "Add admin content management and paid-course access"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/Fadil-.git
git push -u origin main
```

إن كان المستودع موجوداً محلياً وفيه `origin` بالفعل، استبدل أمر `git remote add` بـ:

```bash
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/Fadil-.git
git push
```

## النشر الدائم (Render أو Railway)

### MongoDB Atlas

1. أنشئ Organization ثم Project وCluster مجاني أو مدفوع في [MongoDB Atlas](https://www.mongodb.com/atlas).
2. في **Database Access** أنشئ مستخدم قاعدة بيانات بكلمة مرور قوية، ثم في **Network Access** أضف عنوان IP لخدمة الاستضافة (أو `0.0.0.0/0` مؤقتاً مع كلمة مرور قوية).
3. اضغط **Connect → Drivers** وانسخ الرابط، واستبدل اسم المستخدم وكلمة المرور واسم قاعدة البيانات. ضعه في `MONGO_URI`.

### Render

1. ارفع هذا المشروع إلى مستودع GitHub خاص بك.
2. من Render اختر **New → Web Service** واربط المستودع.
3. اختر Node، ثم: Build Command: `npm install`، Start Command: `npm start`.
4. أضف Environment Variables: `MONGO_URI` و`JWT_SECRET` (قيمة عشوائية طويلة) و`ADMIN_USERNAME` و`ADMIN_PASSWORD` و`NODE_ENV=production` و`CLIENT_URL=https://YOUR-SERVICE.onrender.com`.
5. لا تضف `PORT`: Render يمرره تلقائياً و`server.js` يستخدم `process.env.PORT`.
6. اختر خطة مدفوعة إن كان مطلوباً عدم النوم؛ الخدمة المجانية قد تتوقف عند عدم الاستخدام، ولذلك ليست 24/7 فعلياً.

### Railway

1. اختر **New Project → Deploy from GitHub repo**.
2. أضف Variables نفسها أعلاه، وأضف دوميناً من **Settings → Networking**.
3. Railway يكتشف `npm start` ويعيّن `PORT` تلقائياً.

> ملاحظة الملفات: القرص المحلي في Render/Railway ليس تخزيناً دائماً بعد إعادة النشر. للإنتاج، اجعل `uploads/` على S3 أو Cloudinary. قاعدة البيانات دائمة في Atlas.
