# 🚀 دليل نشر نظام AI Quiz على Railway

## المحتويات
1. [المتطلبات](#المتطلبات)
2. [تثبيت Railway CLI](#تثبيت-railway-cli)
3. [إعداد المشروع](#إعداد-المشروع)
4. [نشر المشروع](#نشر-المشروع)
5. [إضافة OpenAI API Key](#إضافة-openai-api-key)
6. [ربط الدومين aldosari.net](#ربط-الدومين-aldosarinet)
7. [التحقق من العمل](#التحقق-من-العمل)
8. [الصيانة](#الصيانة)
9. [استكشاف الأخطاء](#استكشاف-الأخطاء)

---

## المتطلبات

قبل البدء، تأكد من توفر:

- ✅ حساب Railway (Hobby Plan مفعّل)
- ✅ Git مثبت على جهازك
- ✅ Node.js 18+ مثبت
- ✅ OpenAI API Key
- ✅ الدومين aldosari.net على name.com
- ✅ ملفات المشروع (ai-quiz-system.zip)

---

## تثبيت Railway CLI

### لـ Windows:
```powershell
# استخدم PowerShell كمسؤول
iwr https://railway.app/install.ps1 | iex
```

### لـ macOS:
```bash
# استخدم Homebrew
brew install railway
```

### لـ Linux:
```bash
# استخدم npm
npm i -g @railway/cli
```

### التحقق من التثبيت:
```bash
railway --version
```

يجب أن تظهر رسالة مثل: `railway version 3.x.x`

---

## إعداد المشروع

### 1. فك ضغط المشروع:
```bash
# فك ضغط الملف
unzip ai-quiz-system.zip
cd ai-quiz-system
```

### 2. التحقق من الملفات:
```bash
# تأكد من وجود هذه الملفات
ls -la

# يجب أن ترى:
# - server.js
# - package.json
# - public/
# - .gitignore
```

### 3. إنشاء Git Repository:
```bash
# إذا لم يكن Git مهيأ
git init

# إضافة الملفات
git add .

# أول Commit
git commit -m "Initial commit - AI Quiz System"
```

---

## نشر المشروع

### 1. تسجيل الدخول إلى Railway:
```bash
railway login
```

سيفتح متصفحك تلقائياً للتصريح. اضغط **Authorize**.

### 2. إنشاء مشروع جديد:
```bash
# إنشاء مشروع Railway
railway init

# اختر: "Create new project"
# الاسم المقترح: aldosari-quiz-system
```

### 3. ربط المشروع بـ Railway:
```bash
# ربط المشروع
railway link
```

### 4. نشر المشروع:
```bash
# نشر على Railway
railway up
```

**النتيجة المتوقعة:**
```
✓ Deployment successful
✓ Service URL: https://aldosari-quiz-system-production.up.railway.app
```

⏱️ **الوقت المتوقع:** 2-3 دقائق

---

## إضافة OpenAI API Key

### الطريقة 1: عبر CLI (الأسهل):
```bash
# إضافة OpenAI API Key
railway variables set OPENAI_API_KEY=sk-proj-your-actual-key-here

# إضافة اسم النموذج
railway variables set OPENAI_MODEL=gpt-4o-mini

# إضافة ALLOWED_ORIGIN (للدومين)
railway variables set ALLOWED_ORIGIN=https://aldosari.net

# إضافة PORT (اختياري، Railway يضبطه تلقائياً)
railway variables set PORT=3000
```

### الطريقة 2: عبر Dashboard:

1. افتح: https://railway.app/dashboard
2. اذهب لمشروعك: **aldosari-quiz-system**
3. اضغط على الـ **Service** (server.js)
4. اذهب لـ **Variables** (من القائمة الجانبية)
5. أضف المتغيرات:
   ```
   OPENAI_API_KEY = sk-proj-your-key
   OPENAI_MODEL = gpt-4o-mini
   ALLOWED_ORIGIN = https://aldosari.net
   ```
6. احفظ التغييرات

**ملاحظة مهمة:** بعد إضافة المتغيرات، Railway سيعيد نشر المشروع تلقائياً (1-2 دقيقة).

---

## ربط الدومين aldosari.net

### الخطوة 1: إضافة الدومين في Railway

#### عبر CLI:
```bash
# إضافة الدومين المخصص
railway domain
```

**ستظهر لك قائمة، اختر:** "Add custom domain"

**أدخل الدومين:**
```
aldosari.net
```

**ثم أضف أيضاً:**
```
www.aldosari.net
```

#### عبر Dashboard:

1. افتح مشروعك في Railway Dashboard
2. اذهب للـ **Service** (server.js)
3. اذهب لـ **Settings** (من القائمة الجانبية)
4. ابحث عن قسم **Domains**
5. اضغط **Generate Domain** أولاً (للحصول على Railway domain)
6. ثم اضغط **Custom Domain**
7. أضف: `aldosari.net`
8. كرر الخطوة وأضف: `www.aldosari.net`

**Railway سيعطيك DNS Target مثل:**
```
aldosari-quiz-system.up.railway.app
```

**احتفظ بهذا العنوان!** 📝

---

### الخطوة 2: ضبط DNS في name.com

1. **سجّل دخول إلى name.com:**
   - اذهب: https://www.name.com
   - سجّل دخولك

2. **اذهب لإدارة DNS:**
   - My Account → Domains
   - اختر **aldosari.net**
   - اضغط **Manage** → **DNS Records**

3. **احذف السجلات القديمة (إن وجدت):**
   - احذف أي سجلات A أو CNAME قديمة لـ @ و www

4. **أضف سجلات DNS الجديدة:**

   **للدومين الرئيسي (aldosari.net):**
   ```
   Type: CNAME
   Host: @
   Answer: aldosari-quiz-system.up.railway.app
   TTL: 300
   ```

   **لـ www:**
   ```
   Type: CNAME
   Host: www
   Answer: aldosari-quiz-system.up.railway.app
   TTL: 300
   ```

   **مهم جداً:** استبدل `aldosari-quiz-system.up.railway.app` بالعنوان الفعلي الذي حصلت عليه من Railway!

5. **احفظ التغييرات:**
   - اضغط **Add Record** لكل سجل
   - اضغط **Save** أو **Submit**

---

### الخطوة 3: الانتظار لتفعيل DNS

⏱️ **الوقت المتوقع:** 5-30 دقيقة (أحياناً حتى ساعة)

**كيف تتحقق؟**

في Terminal/PowerShell:
```bash
# للتحقق من CNAME
nslookup aldosari.net

# أو
dig aldosari.net
```

**يجب أن ترى:** `aldosari-quiz-system.up.railway.app` في النتيجة.

---

### الخطوة 4: تفعيل SSL (تلقائي)

Railway يفعّل SSL تلقائياً! 🎉

- **بعد تحديث DNS:** انتظر 5-10 دقائق
- **Railway يصدر شهادة SSL مجانية تلقائياً**
- **لا تحتاج فعل أي شيء!**

**للتحقق:**
1. افتح: https://aldosari.net
2. اضغط على القفل 🔒 في شريط العنوان
3. يجب أن ترى: **Connection is secure**

---

## التحقق من العمل

### 1. اختبار عبر Railway Domain:
```bash
# افتح المتصفح على:
https://aldosari-quiz-system.up.railway.app
```

**يجب أن ترى:** صفحة رئيسية لنظام AI Quiz

---

### 2. اختبار عبر الدومين المخصص:
```bash
# افتح المتصفح على:
https://aldosari.net
```

**يجب أن ترى:** نفس الصفحة

---

### 3. اختبار OpenAI API:

1. افتح الموقع: https://aldosari.net
2. ارفع ملف PDF تجريبي
3. اضغط **إنشاء أسئلة**
4. يجب أن تظهر الأسئلة خلال 10-30 ثانية

**إذا لم يعمل:**
- تحقق من صحة OpenAI API Key في Variables
- افتح Railway Dashboard → Logs
- ابحث عن أخطاء في Logs

---

### 4. التحقق من الـ Logs:

#### عبر CLI:
```bash
# عرض Logs مباشرة
railway logs
```

#### عبر Dashboard:
1. افتح: https://railway.app/dashboard
2. اذهب لمشروعك
3. اختر Service → **Deployments**
4. اضغط على آخر Deployment
5. اضغط **View Logs**

**Logs صحية يجب أن تحتوي على:**
```
✅ Server running on port 3000
✅ OpenAI API initialized
✅ CORS configured for https://aldosari.net
```

---

## الصيانة

### مراقبة الاستخدام:

#### عرض الاستخدام الحالي:
```bash
railway status
```

#### عبر Dashboard:
1. اذهب: https://railway.app/dashboard
2. اختر مشروعك
3. في الأعلى ستجد: **Usage this month**
4. اضغط عليه لعرض التفاصيل

**ما تراقبه:**
- **Memory Usage:** يجب أن يكون < 500 MB عادة
- **CPU Usage:** يجب أن يكون < 20% عادة
- **Bandwidth:** راقب الاستهلاك الشهري
- **Build Minutes:** عدد دقائق البناء

---

### تحديث المشروع:

#### 1. تعديل الكود محلياً:
```bash
# عدّل الملفات كما تريد
nano server.js

# أو افتح في محرر نصوص
```

#### 2. حفظ التغييرات في Git:
```bash
git add .
git commit -m "تحديث: وصف التحديث"
```

#### 3. نشر التحديث:
```bash
railway up
```

**أو الأسهل:**
```bash
# كل الخطوات في أمر واحد
git add . && git commit -m "Update" && railway up
```

---

### إعادة تشغيل الخدمة:

```bash
# إعادة تشغيل
railway restart
```

**أو عبر Dashboard:**
1. اذهب للـ Service
2. Settings → **Restart Service**

---

### النسخ الاحتياطية:

Railway يحتفظ بـ:
- ✅ آخر 20 Deployment
- ✅ Variables history
- ✅ Logs (7 أيام)

**استرجاع نسخة قديمة:**
1. Dashboard → Deployments
2. اختر Deployment القديم
3. اضغط **Redeploy**

---

## استكشاف الأخطاء

### المشكلة 1: الموقع لا يفتح

**الحل:**
```bash
# تحقق من الـ Logs
railway logs

# تحقق من Status
railway status

# أعد التشغيل
railway restart
```

---

### المشكلة 2: OpenAI API لا تعمل

**السبب المحتمل:**
- API Key خاطئ
- رصيد OpenAI منتهي
- CORS خطأ

**الحل:**
```bash
# تحقق من Variables
railway variables

# تحديث API Key
railway variables set OPENAI_API_KEY=sk-proj-new-key

# تحقق من Logs
railway logs | grep -i "openai\|error"
```

---

### المشكلة 3: الدومين لا يعمل

**الحل:**

1. **تحقق من DNS:**
```bash
nslookup aldosari.net
```

2. **تأكد من إعدادات name.com:**
   - سجلات CNAME صحيحة؟
   - Railway domain صحيح؟

3. **انتظر تحديث DNS (حتى 48 ساعة)**

4. **امسح Cache:**
```bash
# Windows
ipconfig /flushdns

# macOS
sudo dscacheutil -flushcache

# Linux
sudo systemd-resolve --flush-caches
```

---

### المشكلة 4: SSL لا يعمل

**الحل:**

1. **انتظر 10-15 دقيقة بعد ضبط DNS**
2. **تحقق من أن DNS يشير بشكل صحيح**
3. **في Railway Dashboard:**
   - Settings → Domains
   - يجب أن ترى ✅ بجانب الدومين

---

### المشكلة 5: استهلاك عالي

**الحل:**

1. **راجع Logs للبحث عن loops:**
```bash
railway logs | grep -i "error\|loop"
```

2. **تحقق من عدد الـ Requests:**
   - Dashboard → Metrics
   - ابحث عن Request spikes

3. **قلل Resources إذا لزم:**
   - Settings → Resources
   - خفض RAM/CPU limits

---

## الأوامر المفيدة السريعة

```bash
# عرض معلومات المشروع
railway status

# عرض Logs مباشرة
railway logs

# إعادة التشغيل
railway restart

# نشر تحديث
railway up

# فتح Dashboard
railway open

# عرض Variables
railway variables

# إضافة Variable
railway variables set KEY=value

# حذف Variable
railway variables delete KEY

# ربط مشروع مختلف
railway link

# فصل المشروع الحالي
railway unlink
```

---

## النصائح والتوصيات

### 🔒 الأمان:
- ✅ لا تشارك OpenAI API Key مع أحد
- ✅ استخدم Variables في Railway (لا تضعها في الكود)
- ✅ فعّل 2FA على حساب Railway
- ✅ راقب الاستخدام بانتظام

### 💰 التوفير:
- ✅ أوقف المشروع في الإجازات الطويلة
- ✅ راقب استهلاك OpenAI (استخدم gpt-4o-mini)
- ✅ قلل عدد الأسئلة المولدة إذا لزم
- ✅ استخدم Caching للأسئلة المتكررة (تطوير مستقبلي)

### 🚀 الأداء:
- ✅ استخدم Railway Regions قريبة من الكويت
- ✅ راقب Memory Usage
- ✅ أضف Error Handling جيد
- ✅ استخدم Logging للتتبع

### 📊 المراقبة:
- ✅ تحقق من Dashboard أسبوعياً
- ✅ راقب Logs عند المشاكل
- ✅ تتبع Usage Metrics
- ✅ اضبط Alerts (في Pro Plan)

---

## الموارد المفيدة

### Railway:
- **Documentation:** https://docs.railway.com
- **Discord Community:** https://discord.gg/railway
- **Status Page:** https://status.railway.com
- **Blog:** https://blog.railway.com

### OpenAI:
- **API Documentation:** https://platform.openai.com/docs
- **Pricing:** https://openai.com/pricing
- **Usage Dashboard:** https://platform.openai.com/usage

### name.com:
- **Support:** https://www.name.com/support
- **DNS Guide:** https://www.name.com/support/articles/205188538

---

## خطة الطوارئ

### إذا Railway توقف:

1. **تحقق من Status:**
   - https://status.railway.com

2. **انتقل لـ Backup Plan:**
   - نشر على Render (مجاني)
   - نشر على Fly.io (مجاني)
   - name.com Cloud Hosting ($6)

3. **غيّر DNS فوراً:**
   - حدّث CNAME في name.com
   - يستغرق 5-30 دقيقة

---

## الخلاصة

✅ **مشروعك الآن على Railway!**
✅ **متصل بـ aldosari.net**
✅ **SSL مفعّل تلقائياً**
✅ **جاهز للاستخدام من الطلاب**

### التكلفة المتوقعة:
- Railway Hobby: $5-8/شهر
- OpenAI API: $1-3/شهر
- **المجموع:** $6-11/شهر

### الدعم:
- Railway Discord: https://discord.gg/railway
- GitHub Issues: أنشئ repository ورفع issues
- التواصل معي عند الحاجة

---

**🎉 مبروك! مشروعك الآن على الإنترنت!**

**رابط الموقع:** https://aldosari.net

---

## ملاحظة أخيرة

هذا الدليل شامل لكل ما تحتاجه. احتفظ به للرجوع إليه!

إذا واجهت أي مشكلة، راجع قسم [استكشاف الأخطاء](#استكشاف-الأخطاء) أو اسألني مباشرة.

**حظاً موفقاً! 🚀**
