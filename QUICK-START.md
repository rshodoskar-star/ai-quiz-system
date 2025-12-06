# ⚡ دليل البدء السريع - Railway

## 🚀 نشر في 5 دقائق!

### 1. ثبّت Railway CLI

**Windows:**
```powershell
iwr https://railway.app/install.ps1 | iex
```

**macOS:**
```bash
brew install railway
```

**Linux:**
```bash
npm i -g @railway/cli
```

---

### 2. سجّل الدخول
```bash
railway login
```

---

### 3. أعد المشروع
```bash
cd ai-quiz-system
git init
git add .
git commit -m "Initial commit"
```

---

### 4. انشر!
```bash
railway init
railway up
```

---

### 5. أضف OpenAI Key
```bash
railway variables set OPENAI_API_KEY=sk-proj-your-key
railway variables set OPENAI_MODEL=gpt-4o-mini
railway variables set ALLOWED_ORIGIN=https://aldosari.net
```

---

### 6. اربط الدومين

**في Railway Dashboard:**
1. Settings → Domains → Custom Domain
2. أدخل: `aldosari.net`
3. انسخ الـ Railway domain (مثل: `xxx.up.railway.app`)

**في name.com:**
1. Manage DNS → Add Record
2. Type: `CNAME`, Host: `@`, Answer: `xxx.up.railway.app`
3. Type: `CNAME`, Host: `www`, Answer: `xxx.up.railway.app`

---

### 7. انتظر وافتح!

⏱️ انتظر 5-15 دقيقة

ثم افتح: **https://aldosari.net**

---

## ✅ انتهيت!

### أوامر مفيدة:

```bash
# عرض Logs
railway logs

# إعادة التشغيل
railway restart

# تحديث
railway up

# فتح Dashboard
railway open
```

---

## 🆘 مشاكل؟

**الموقع لا يفتح:**
```bash
railway logs
railway restart
```

**الدومين لا يعمل:**
- تحقق من DNS في name.com
- انتظر حتى ساعة للتحديث
- امسح DNS cache: `ipconfig /flushdns`

**OpenAI لا يعمل:**
```bash
railway variables
railway variables set OPENAI_API_KEY=sk-proj-new-key
```

---

**راجع الدليل الكامل في:** `RAILWAY-DEPLOYMENT-GUIDE.md`
