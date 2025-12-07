# 💻 Code Snippets – AI Quiz System

تحتوي هذه الوثيقة على مجموعة من الأمثلة العملية لاستخراج النصوص من ملفات PDF، وترتيب الكتل، ومعالجة اللغة العربية، والكشف عن الصفحات المصورة (OCR)، وذلك باستخدام مكتبة **PyMuPDF** ومكتبات أخرى. يمكن استخدامها كأساس لتجربة الأفكار محلياً.

## 1. مقارنة أوضاع استخراج النص (`text` vs `dict`)

```python
import fitz  # PyMuPDF

# فتح ملف PDF
with fitz.open("example.pdf") as doc:
    page = doc[0]

    # الوضع البسيط: text
    text_simple = page.get_text("text")
    print("Extracted using 'text':\n", text_simple[:500])

    # الوضع المتقدم: dict
    text_dict = page.get_text("dict")
    print("Keys in dict output:", text_dict.keys())
    # dict['blocks'] يحتوي على الكتل مع إحداثياتها
```

## 2. فرز الكتل وترتيب النص العربي (RTL)

```python
from operator import itemgetter

# استخراج الكتل من dict
blocks = text_dict.get("blocks", [])

# فرز البلوكات من الأعلى للأسفل (y) ثم من اليمين لليسار (x سالب)
sorted_blocks = sorted(
    blocks, key=lambda b: (b["bbox"][1], -b["bbox"][0])
)

# تجميع النص من الكتل
lines = []
for block in sorted_blocks:
    if block.get("type") != 0:  # 0 تعني نص، 1 تعني صورة
        continue
    for line in block.get("lines", []):
        # ترتيب spans من اليمين لليسار
        spans = sorted(line.get("spans", []), key=lambda s: -s["bbox"][0])
        line_text = "".join(span["text"] for span in spans)
        lines.append(line_text.strip())

full_text = "\n".join(lines)
print(full_text)
```

## 3. اكتشاف الصفحات المصورة وتشغيل OCR

```python
from paddleocr import PaddleOCR

ocr_engine = PaddleOCR(use_angle_cls=True, lang='ar')

# دالة لاكتشاف ما إذا كانت الصفحة مصورة
def is_scanned_page(page, text):
    # إذا كان النص قصيرًا جدًا وهناك صور في الصفحة
    return (len(text.strip()) < 80) and (len(page.get_images()) > 0)

for page_num in range(len(doc)):
    page = doc[page_num]
    raw_text = page.get_text("text")
    if is_scanned_page(page, raw_text):
        # تشغيل OCR
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_path = f"tmp_page{page_num}.png"
        pix.save(img_path)
        ocr_result = ocr_engine.ocr(img_path, cls=True)
        scanned_text = "\n".join([line[1][0] for line in ocr_result])
        print("OCR text:\n", scanned_text)
    else:
        print("Parsed text:\n", raw_text[:200])
```

## 4. تطبيع النص وإزالة التشكيل

```python
import re
import unicodedata
from ftfy import fix_text

def normalize_arabic_text(text: str) -> str:
    # إصلاح UTF‑8 غير الصحيح
    text = fix_text(text)
    # إزالة التشكيل
    text = re.sub(r'[\u064B-\u0652]', '', text)
    # توحيد الألف
    text = re.sub(r'[أإآ]', 'ا', text)
    # إزالة المسافات المكررة
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

clean_text = normalize_arabic_text(full_text)
print(clean_text[:500])
```

## 5. اكتشاف الأعمدة والجداول (مفهوم مبسط)

اكتشاف الأعمدة يعتمد على ملاحظة تغير كبير في إحداثيات `x` بين البلوكات، مما يشير إلى وجود عمود جديد. يمكن توسيع الكود التالي للكشف عن الأعمدة:

```python
columns = []
current_column = []
last_x = None

for block in sorted_blocks:
    x0 = block["bbox"][0]
    if last_x is not None and abs(x0 - last_x) > 200:  # عتبة مسافة بين الأعمدة
        columns.append(current_column)
        current_column = []
    current_column.append(block)
    last_x = x0

if current_column:
    columns.append(current_column)

print(f"Detected {len(columns)} columns")
```

## 6. مثال كامل للـ Pipeline

```python
def extract_full_text(pdf_path: str) -> str:
    """يجمع بين parsing و OCR وتطبيع النص."""
    doc = fitz.open(pdf_path)
    all_pages_text = []

    for page in doc:
        # الوضع dict للحصول على تخطيط
        pdict = page.get_text("dict")
        blocks = sorted(
            pdict.get("blocks", []), key=lambda b: (b["bbox"][1], -b["bbox"][0])
        )
        page_lines = []
        for block in blocks:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = sorted(line.get("spans", []), key=lambda s: -s["bbox"][0])
                text_line = "".join(span["text"] for span in spans).strip()
                page_lines.append(text_line)
        page_text = "\n".join(page_lines)

        # إذا كان النص قصيراً استخدم OCR
        if is_scanned_page(page, page_text):
            pix = page.get_pixmap(matrix=fitz.Matrix(2,2))
            tmp = "tmp.png"
            pix.save(tmp)
            ocr_text = ocr_engine.ocr(tmp, cls=True)
            page_text = "\n".join([x[1][0] for x in ocr_text])
        
        # تطبيع النص
        page_text = normalize_arabic_text(page_text)
        all_pages_text.append(page_text)

    return "\n\n".join(all_pages_text)
```

استخدم هذه الأمثلة كأساس لتجربة تقنيات استخراج النصوص وترتيبها، وتحسين دقة الأسئلة المولدة من ملفات PDF.
