# 🌐 دليل النشر - Deployment Guide

دليل شامل لنشر نظام الاختبارات الذكي على منصات مختلفة.

---

## 📋 جدول المحتويات

1. [النشر المحلي (Local)](#1-النشر-المحلي-local)
2. [النشر على Heroku](#2-النشر-على-heroku)
3. [النشر على DigitalOcean](#3-النشر-على-digitalocean)
4. [النشر على AWS](#4-النشر-على-aws)
5. [النشر على VPS](#5-النشر-على-vps-عام)
6. [استخدام Docker](#6-استخدام-docker)

---

## 1. النشر المحلي (Local)

### Windows

#### الطريقة 1: تشغيل عادي
```cmd
npm start
```

#### الطريقة 2: تشغيل في الخلفية
```cmd
# استخدم pm2
npm install -g pm2
pm2 start server.js --name quiz-system
pm2 save
```

### Mac/Linux

#### الطريقة 1: تشغيل عادي
```bash
npm start
```

#### الطريقة 2: تشغيل كخدمة
```bash
# استخدام pm2
npm install -g pm2
pm2 start server.js --name quiz-system
pm2 startup
pm2 save
```

---

## 2. النشر على Heroku

### المتطلبات
- حساب Heroku مجاني
- Heroku CLI مثبّت

### الخطوات

#### 1. تثبيت Heroku CLI
```bash
# Mac
brew tap heroku/brew && brew install heroku

# Windows
# حمّل من: https://devcenter.heroku.com/articles/heroku-cli
```

#### 2. تسجيل الدخول
```bash
heroku login
```

#### 3. إنشاء تطبيق
```bash
heroku create your-quiz-system
```

#### 4. إضافة المتغيرات البيئية
```bash
heroku config:set OPENAI_API_KEY=sk-your-key-here
heroku config:set OPENAI_MODEL=gpt-4o-mini
heroku config:set MAX_PDF_SIZE_MB=10
heroku config:set NODE_ENV=production
```

#### 5. إنشاء Procfile
قم بإنشاء ملف `Procfile` في المجلد الرئيسي:
```
web: node server.js
```

#### 6. النشر
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

#### 7. فتح التطبيق
```bash
heroku open
```

### مراقبة Logs
```bash
heroku logs --tail
```

### تكاليف Heroku
- **Hobby Plan:** $7/شهر
- **Professional:** $25-$250/شهر

---

## 3. النشر على DigitalOcean

### المتطلبات
- حساب DigitalOcean
- Droplet (VPS) بـ Ubuntu 22.04

### الخطوات

#### 1. إنشاء Droplet
- اختر Ubuntu 22.04
- الحجم الأدنى: Basic ($6/شهر)
- المنطقة: أقرب منطقة لك

#### 2. الاتصال بـ SSH
```bash
ssh root@your-droplet-ip
```

#### 3. تثبيت Node.js
```bash
# تحديث النظام
apt update && apt upgrade -y

# تثبيت Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# التحقق
node --version
npm --version
```

#### 4. تثبيت المشروع
```bash
# إنشاء مجلد
mkdir /var/www
cd /var/www

# استنساخ المشروع (أو رفع الملفات)
git clone <your-repo-url> quiz-system
cd quiz-system

# تثبيت الحزم
npm install
```

#### 5. إعداد المتغيرات البيئية
```bash
nano .env
```

أضف:
```env
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o-mini
PORT=3000
NODE_ENV=production
MAX_PDF_SIZE_MB=10
ALLOWED_ORIGIN=http://your-domain.com
```

#### 6. تثبيت PM2
```bash
npm install -g pm2
pm2 start server.js --name quiz-system
pm2 startup
pm2 save
```

#### 7. إعداد Nginx كـ Reverse Proxy
```bash
# تثبيت Nginx
apt install -y nginx

# إنشاء ملف تكوين
nano /etc/nginx/sites-available/quiz-system
```

أضف:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

تفعيل:
```bash
ln -s /etc/nginx/sites-available/quiz-system /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

#### 8. تفعيل HTTPS (اختياري)
```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

---

## 4. النشر على AWS

### المتطلبات
- حساب AWS
- EC2 Instance

### الخطوات

#### 1. إنشاء EC2 Instance
- اختر Ubuntu 22.04 LTS
- نوع: t2.micro (مجاني لسنة)
- افتح Port 80, 443, 22

#### 2. الاتصال
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

#### 3. اتبع نفس خطوات DigitalOcean
من الخطوة 3 إلى الخطوة 8 أعلاه.

### تكاليف AWS
- **t2.micro:** مجاني لسنة (750 ساعة/شهر)
- **t2.small:** ~$17/شهر
- + تكاليف النطاق الترددي

---

## 5. النشر على VPS (عام)

### أي VPS (Contabo, Vultr, Linode, إلخ)

#### 1. اختر VPS
- نظام: Ubuntu 22.04
- RAM: 1GB على الأقل
- Storage: 10GB على الأقل

#### 2. اتبع خطوات DigitalOcean
من الخطوة 2 إلى الخطوة 8

---

## 6. استخدام Docker

### إنشاء Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

### إنشاء .dockerignore
```
node_modules
.env
.git
npm-debug.log
```

### إنشاء docker-compose.yml
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_MODEL=${OPENAI_MODEL}
      - PORT=3000
      - NODE_ENV=production
    restart: unless-stopped
```

### تشغيل
```bash
# بناء
docker-compose build

# تشغيل
docker-compose up -d

# إيقاف
docker-compose down
```

---

## 📊 مقارنة المنصات

| المنصة | التكلفة الشهرية | السهولة | الأداء | التوصية |
|--------|-----------------|---------|---------|----------|
| **Heroku** | $7 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | للمبتدئين |
| **DigitalOcean** | $6 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | الأفضل شامل |
| **AWS EC2** | $0-17 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | للمحترفين |
| **Vultr** | $5 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | جيد جداً |
| **Contabo** | €4 | ⭐⭐⭐ | ⭐⭐⭐⭐ | أرخص |

---

## 🔒 تأمين النظام

### 1. تفعيل Firewall
```bash
# Ubuntu
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

### 2. تحديث منتظم
```bash
apt update && apt upgrade -y
```

### 3. استخدام HTTPS
- احصل على شهادة SSL من Let's Encrypt
- فعّل HTTPS في Nginx

### 4. حماية المتغيرات البيئية
- لا ترفع `.env` على Git
- استخدم secrets في منصات النشر

---

## 📈 المراقبة والصيانة

### مراقبة PM2
```bash
pm2 status
pm2 logs
pm2 monit
```

### مراقبة Nginx
```bash
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```

### مراقبة الموارد
```bash
htop
df -h
free -h
```

---

## 🆘 حل مشاكل النشر

### المشكلة: "Port already in use"

**الحل:**
```bash
# ابحث عن العملية
lsof -i :3000

# أوقفها
kill -9 <PID>
```

### المشكلة: "Permission denied"

**الحل:**
```bash
# أعطِ صلاحيات
chmod +x server.js
chown -R $USER:$USER /var/www/quiz-system
```

### المشكلة: "Cannot connect to database"

**الملاحظة:** هذا المشروع لا يستخدم قاعدة بيانات حالياً.

---

## ✅ قائمة التحقق للنشر

- [ ] Server مثبّت ويعمل
- [ ] Node.js وNPM مثبّتان
- [ ] المشروع منسوخ على Server
- [ ] `npm install` تم تنفيذه
- [ ] `.env` موجود ومُعدّ بشكل صحيح
- [ ] PM2 مثبّت ويدير العملية
- [ ] Nginx مُعدّ (إن استخدم)
- [ ] Firewall مُفعّل
- [ ] HTTPS مُفعّل (للإنتاج)
- [ ] Logs تُراقَب
- [ ] Backup plan موجود

---

**مبروك! الآن نظامك متاح على الإنترنت! 🌐**
