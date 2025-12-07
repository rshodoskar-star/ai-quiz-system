# دليل إصلاح المشكلات

هذا المستند يجمع حلول المشكلات التقنية التي ظهرت أثناء تطوير **نظام الاختبارات الذكي** (AI Quiz System). تم توحيد النصائح من أدلة الإصلاح السابقة في وثيقة واحدة لتبسيط الرجوع إليها وتسهل على المطورين معالجة أي عوائق.

## 1. مشكلة تثبيت PaddlePaddle و PaddleOCR

- **الوصف:** مكتبة **PaddlePaddle** (الإصدار `2.5.2`) تتطلب العديد من المكتبات الأصلية مثل **libGL** و **libjpeg**. عند استخدام صورة Docker خفيفة الوزن (`python:3.10-slim`) تفشل عملية التثبيت ويؤدي ذلك إلى توقف بناء الحاوية أو عدم عمل `paddleocr`.
- **الحل:** استخدم مرآة Baidu لتثبيت المكتبة، وبعدها ثبّت بقية الحزم:

  ```bash
  # تثبيت PaddlePaddle من المرآة الصينية
  pip install paddlepaddle==2.5.2 -i https://mirror.baidu.com/pypi/simple

  # تثبيت مكتبة OCR ومكتبات أخرى
  pip install paddleocr opencv-python-headless
  ```

- **بدائل في حال استمرار المشكلة:**
  - يمكن تعطيل خاصية **OCR** مؤقتًا في ملف `extract_pdf.py` واستخراج النص باستخدام PyMuPDF فقط. هذا يعني أن الملفات الممسوحة ضوئيًا لن تُعالج، لكنها تمنع توقف التطبيق.
  - في حالات خاصة يمكن الرجوع إلى إصدار سابق من المشروع (**الإصدار V7.0**) الذي لا يعتمد على OCR إلى أن يتم إصلاح بيئة التثبيت.

## 2. مشكلة “Failed to parse” عند استخدام PyMuPDF

- **الوصف:** عند استخراج النص من بعض ملفات PDF باستخدام PyMuPDF تظهر رسالة خطأ *Failed to parse* ناتجة عن صفحات تالفة أو بيانات غير مدعومة في المستند.
- **الحلول المقترحة:**
  - إضافة معالجة استثنائية في `extract_pdf.py` لتجاهل الصفحات التي تُفشل عملية التحليل:

    ```python
    for page_number in range(len(doc)):
        try:
            page = doc.load_page(page_number)
            # تابع استخراج النص والتنسيق
        except Exception:
            # سجل الصفحة وتخطَّها
            continue
    ```
  - التأكد من استخدام إصدار مستقر من PyMuPDF (مثلاً `1.22.0`) أو تجربة التحديثات الأحدث عند توفرها، فقد تصلح مشكلات parsing.
  - إذا كان الملف يحتوي صفحات ممسوحة ضوئياً فقط، فعّل ميزة OCR (انظر القسم السابق) لاستخراج النص.

## 3. تحديث Dockerfile لتثبيت المكتبات الأصلية

- **الوصف:** لم تكن ملفات Docker السابقة تحتوي على المكتبات الأصلية المطلوبة لعمل **PyMuPDF** و **PaddleOCR**، مما أدى إلى فشل عملية البناء أو ظهور أخطاء في وقت التشغيل.
- **الحل:** استخدم ملف Docker محدثًا يقوم بتثبيت المكتبات الضرورية قبل تثبيت الحزم. مثال لملف محدث:

  ```Dockerfile
  # استخدم صورة أساس خفيفة
  FROM python:3.10-slim

  # تثبيت المكتبات الأصلية اللازمة
  RUN apt-get update && apt-get install -y \
      libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 libstdc++6 \
      libjpeg62-turbo libpng16-16 libfreetype6 liblcms2-2 libwebp7 \
      libtiff6 libopenjp2-7 libxcb1 && \
      apt-get clean && rm -rf /var/lib/apt/lists/*

  WORKDIR /app
  COPY requirements.txt /app/

  # تحديث pip ثم تثبيت الحزم
  RUN pip install --upgrade pip setuptools wheel && \
      pip install paddlepaddle==2.5.2 -i https://mirror.baidu.com/pypi/simple && \
      pip install paddleocr opencv-python-headless && \
      pip install PyMuPDF ftfy regex fastapi uvicorn python-multipart

  COPY . /app

  EXPOSE 8000

  CMD ["python3", "server.js"]
  ```

- يضمن هذا المثال توفر المكتبات الأصلية الضرورية داخل الحاوية ويقوم بتنصيب جميع الحزم بالتسلسل الصحيح.

## 4. نصائح عامة لمعالجة الأخطاء

- احرص على تحديث ملف `requirements.txt` ليتضمن الإصدارات الصحيحة من:
  - `PyMuPDF`
  - `paddleocr`
  - `opencv-python-headless`
  - `ftfy`
  - وأي مكتبات أخرى مستخدمة في المشروع.
- قبل النشر، جرّب بناء المشروع محلياً أو في بيئة اختبار للتأكد من أن كل شيء يعمل بشكل صحيح. قم بمراجعة سجل البناء (`docker build logs`) لمعرفة أسباب أي أخطاء.
- إذا ظهرت أخطاء تتعلق بذاكرة النظام أو بطء في الأداء، يمكن تقليل حجم الصورة باستخدام أوامر مثل `apt-get clean` و`pip cache purge` داخل Dockerfile.
- تذكر أن معالجة الملفات الكبيرة أو الممسوحة ضوئياً يتطلب وقتًا أطول وموارد أكبر، وقد يكون من الأفضل تقييد حجم الملفات المقبولة أو تحذير المستخدمين مسبقاً.

---

هذه الوثيقة تستبدل الملفات التالية: **PADDLEPADDLE-FIX-GUIDE.md**, **PARSE-ERROR-FIX.md** و **DOCKERFILE-FIX-GUIDE.md**. يمكن حذفها من المستودع بعد إضافة هذا الملف لتقليل عدد المستندات وتسهيل عملية الصيانة.
