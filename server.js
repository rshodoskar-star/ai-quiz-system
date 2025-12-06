// ====================================
// AI Quiz System - Backend Server
// ====================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const path = require('path');

// ====================================
// Configuration
// ====================================

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_PDF_SIZE_MB = parseInt(process.env.MAX_PDF_SIZE_MB) || 50;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

// ====================================
// Middleware
// ====================================

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

// JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (Frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
  message: {
    success: false,
    error: 'تم تجاوز الحد الأقصى للطلبات. الرجاء المحاولة لاحقاً.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_PDF_SIZE_BYTES
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('يجب أن يكون الملف من نوع PDF فقط'));
    }
  }
});

// ====================================
// AI Prompt Template
// ====================================

const AI_PROMPT = `أنت أداة متخصصة في تحويل نصوص الامتحانات العربية إلى أسئلة اختيار من متعدد منظمة.

المدخلات:
- نص عربي مستخرج من ملف PDF يحتوي على أسئلة امتحان.
- النص قد يحتوي على:
  - عناوين فصول أو وحدات (مثل: "الفصل الأول"، "الوحدة الثانية")
  - نص السؤال
  - خيارات الإجابة
  - علامات للإجابة الصحيحة (مثل: ✓، ✔، √، *)

مهمتك:
1. استخراج أسئلة الاختيار من متعدد فقط (MCQ).
2. لكل سؤال، استخرج:
   - chapter (نص، اختياري): اسم الفصل إن وجد
   - question (نص، إلزامي): نص السؤال كاملاً
   - options (مصفوفة): 2-10 خيارات للإجابة
   - correct (رقم، إلزامي): رقم الخيار الصحيح (يبدأ من 0)
3. إذا لم تكن هناك علامة واضحة للإجابة الصحيحة، استنتج الإجابة الأصح بناءً على السياق.
4. تنظيف النص:
   - إزالة أرقام الصفحات والترويسات والتذييلات
   - إزالة المسافات والأسطر الزائدة
   - تنظيف النص من أي رموز غريبة
5. حقل الفصل (chapter):
   - إذا كان السؤال ينتمي بوضوح لفصل معين، ضع اسم الفصل
   - وإلا، احذف الحقل أو اجعله null

المخرجات:
- مصفوفة JSON صالحة فقط، بدون أي تعليقات أو شرح أو markdown
- يجب أن تطابق JSON هذا الشكل بالضبط:

[
  {
    "chapter": "الفصل الأول",
    "question": "ما هو تعريف البرمجيات؟",
    "options": [
      "مجموعة من البرامج",
      "أجهزة الحاسوب",
      "الشبكات",
      "قواعد البيانات"
    ],
    "correct": 0
  }
]

قواعد مهمة جداً:
- لا تضف أي نص خارج JSON
- لا تستخدم markdown مثل \`\`\`json
- تأكد من صحة JSON بالكامل
- تأكد أن correct بين 0 و (عدد الخيارات - 1)
- احذف أي سؤال غير مكتمل أو غامض

الآن، استخرج الأسئلة من النص التالي:`;

// ====================================
// Helper Functions
// ====================================

/**
 * Extract text from PDF buffer
 */
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('فشل استخراج النص من ملف PDF');
  }
}

/**
 * Clean extracted text
 */
function cleanText(text) {
  // Remove common headers/footers patterns
  text = text.replace(/تصميم وتطوير ال[رب]مجيات.*?\d{10}/gi, '');
  text = text.replace(/أبو سليم للخدمات الطالبية.*?/gi, '');
  text = text.replace(/خربة? منذ \d{4}/gi, '');
  text = text.replace(/واتساب[\/:]?\s*\d{10}/gi, '');
  text = text.replace(/ال نحلل نرشه.*?/gi, '');
  text = text.replace(/ال نسمح وال نحلل.*?/gi, '');
  
  // Remove page numbers
  text = text.replace(/صفحة\s*\d+/gi, '');
  text = text.replace(/\d+\s*\/\s*\d+/g, '');
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}

/**
 * Call OpenAI to extract questions
 */
async function extractQuestionsWithAI(text, retryCount = 0) {
  const MAX_RETRIES = 2;
  
  try {
    console.log(`Calling OpenAI (attempt ${retryCount + 1})...`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في استخراج وتنظيم أسئلة الامتحانات من النصوص العربية.'
        },
        {
          role: 'user',
          content: `${AI_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: "json_object" }
    });

    const response = completion.choices[0].message.content;
    console.log('OpenAI response received');
    
    // Try to parse JSON
    let questions;
    try {
      const parsed = JSON.parse(response);
      // Handle different possible response formats
      questions = Array.isArray(parsed) ? parsed : parsed.questions || [];
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      
      // Try to extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('فشل تحليل استجابة AI');
      }
    }

    // Validate questions
    const validQuestions = validateQuestions(questions);
    
    if (validQuestions.length === 0 && retryCount < MAX_RETRIES) {
      console.log('No valid questions found, retrying...');
      return extractQuestionsWithAI(text, retryCount + 1);
    }
    
    return validQuestions;
    
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
      return extractQuestionsWithAI(text, retryCount + 1);
    }
    
    throw new Error('فشل استخراج الأسئلة باستخدام الذكاء الاصطناعي');
  }
}

/**
 * Validate questions array
 */
function validateQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions.filter(q => {
    // Check required fields
    if (!q.question || typeof q.question !== 'string') return false;
    if (!Array.isArray(q.options)) return false;
    if (q.options.length < 2) return false;
    if (typeof q.correct !== 'number') return false;
    if (q.correct < 0 || q.correct >= q.options.length) return false;
    
    // Clean fields
    q.question = q.question.trim();
    q.options = q.options.map(opt => String(opt).trim());
    
    if (q.chapter) {
      q.chapter = String(q.chapter).trim();
    }
    
    return true;
  });
}

// ====================================
// API Routes
// ====================================

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    model: OPENAI_MODEL
  });
});

/**
 * Main endpoint: Convert PDF to quiz questions
 */
app.post('/api/quiz-from-pdf', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validate file exists
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم رفع أي ملف'
      });
    }

    console.log(`Processing PDF: ${req.file.originalname} (${req.file.size} bytes)`);

    // Step 1: Extract text from PDF
    console.log('Step 1: Extracting text from PDF...');
    const rawText = await extractTextFromPDF(req.file.buffer);
    
    if (!rawText || rawText.length < 100) {
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ'
      });
    }

    // Step 2: Clean text
    console.log('Step 2: Cleaning text...');
    const cleanedText = cleanText(rawText);
    console.log(`Text cleaned: ${cleanedText.length} characters`);

    // Step 3: Extract questions using AI
    console.log('Step 3: Extracting questions with AI...');
    const questions = await extractQuestionsWithAI(cleanedText);

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة في الملف. تأكد من أن الملف يحتوي على أسئلة اختيار من متعدد.'
      });
    }

    // Get chapters list
    const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))];

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Success! Extracted ${questions.length} questions in ${processingTime}s`);

    // Return success response
    res.json({
      success: true,
      totalQuestions: questions.length,
      chapters: chapters,
      questions: questions,
      processingTime: `${processingTime}s`
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    
    // Handle specific errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `حجم الملف أكبر من الحد المسموح (${MAX_PDF_SIZE_MB} ميجابايت)`
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'حدث خطأ أثناء معالجة الملف'
    });
  }
});

/**
 * Serve frontend
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====================================
// Error Handling
// ====================================

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  res.status(500).json({
    success: false,
    error: err.message || 'حدث خطأ في الخادم'
  });
});

// ====================================
// Start Server
// ====================================

app.listen(PORT, () => {
  console.log('====================================');
  console.log('🚀 AI Quiz System Server');
  console.log('====================================');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🤖 AI Model: ${OPENAI_MODEL}`);
  console.log(`📁 Max PDF size: ${MAX_PDF_SIZE_MB}MB`);
  console.log(`🔒 Rate limit: ${process.env.RATE_LIMIT_MAX_REQUESTS || 10} requests/hour`);
  console.log('====================================');
});

module.exports = app;
