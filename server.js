// ====================================
// AI Quiz System V4.1 ULTIMATE SIMPLE
// Simple approach: PDF → Raw Text → GPT-4 → All Questions
// No complex processing, no chunking, just direct extraction
// ====================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_PDF_SIZE_MB = parseInt(process.env.MAX_PDF_SIZE_MB) || 50;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

// Progress tracking
const progressStore = new Map();

function updateProgress(requestId, progress, message) {
  progressStore.set(requestId, { progress, message, timestamp: Date.now() });
  console.log(`[${requestId}] ${progress}% - ${message}`);
}

function getProgress(requestId) {
  return progressStore.get(requestId) || { progress: 0, message: 'جاري البدء...' };
}

function clearProgress(requestId) {
  progressStore.delete(requestId);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of progressStore.entries()) {
    if (now - value.timestamp > 10 * 60 * 1000) {
      progressStore.delete(key);
    }
  }
}, 60000);

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'تم تجاوز الحد الأقصى للطلبات' }
});

app.use('/api/', limiter);

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_PDF_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('يجب أن يكون الملف PDF'));
    }
  }
});

// ====================================
// SIMPLE AI Prompt - Extract Everything
// ====================================

const SIMPLE_PROMPT = `أنت خبير في قراءة وإعادة كتابة أسئلة الامتحانات.

المهمة:
اقرأ النص التالي بدقة واستخرج جميع أسئلة الاختيار من متعدد (MCQ) الموجودة فيه.

القواعد المهمة:
1. استخرج كل الأسئلة - لا تترك أي سؤال
2. أعد كتابة كل سؤال بالضبط كما هو في النص
3. أعد كتابة كل الخيارات بالضبط
4. استخرج الإجابة الصحيحة

5. لكل سؤال، أنشئ JSON بهذا الشكل:
{
  "chapter": "اسم الفصل إن وجد",
  "question": "نص السؤال بالضبط",
  "options": ["الخيار 1", "الخيار 2", "الخيار 3", "الخيار 4"],
  "correct": 0
}

6. رقم correct يبدأ من 0 (الخيار الأول = 0، الثاني = 1، إلخ)

الصيغة المطلوبة - JSON Array فقط:
[
  {
    "chapter": "الفصل الأول",
    "question": "ما هو تعريف البرمجيات؟",
    "options": ["مجموعة من التعليمات", "الأجهزة المادية", "الشبكات", "قواعد البيانات"],
    "correct": 0
  },
  {
    "chapter": "الفصل الأول", 
    "question": "السؤال الثاني...",
    "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
    "correct": 2
  }
]

تعليمات مهمة جداً:
- JSON فقط، بدون أي نص إضافي
- بدون markdown (لا تكتب \`\`\`json)
- بدون شرح أو تعليقات
- استخرج كل الأسئلة الموجودة في النص
- لا تخترع أسئلة - فقط ما هو موجود
- احرص على الدقة في إعادة الكتابة

النص:`;

// ====================================
// Simple PDF Extraction
// ====================================

async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('فشل استخراج النص من PDF');
  }
}

// ====================================
// Simple Question Extraction - One Call
// ====================================

async function extractAllQuestions(text, requestId) {
  try {
    console.log(`📝 Text length: ${text.length} characters`);
    
    // If text is too long, split into manageable parts
    const MAX_TEXT_LENGTH = 100000; // ~25k tokens
    
    if (text.length > MAX_TEXT_LENGTH) {
      console.log('⚠️ Text too long, splitting...');
      updateProgress(requestId, 60, 'النص طويل، معالجة متعددة...');
      
      // Split by obvious markers (questions, pages, etc)
      const parts = splitTextIntelligently(text, MAX_TEXT_LENGTH);
      
      let allQuestions = [];
      const progressPerPart = 30 / parts.length;
      
      for (let i = 0; i < parts.length; i++) {
        const progress = 60 + Math.round((i + 1) * progressPerPart);
        updateProgress(requestId, progress, `معالجة جزء ${i + 1}/${parts.length}...`);
        
        const questions = await extractQuestionsFromText(parts[i]);
        allQuestions.push(...questions);
        
        if (i < parts.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
      return allQuestions;
    } else {
      updateProgress(requestId, 60, 'استخراج جميع الأسئلة...');
      return await extractQuestionsFromText(text);
    }
    
  } catch (error) {
    console.error('Extraction error:', error);
    throw error;
  }
}

function splitTextIntelligently(text, maxLength) {
  const parts = [];
  
  // Try to split by question markers
  const questionPattern = /(?=(?:\n|^)\s*(?:\d+[\.\):]|س\s*\d+|سؤال\s*\d+))/g;
  const questionBlocks = text.split(questionPattern).filter(b => b.trim());
  
  if (questionBlocks.length > 1) {
    let currentPart = '';
    
    for (const block of questionBlocks) {
      if ((currentPart + block).length <= maxLength) {
        currentPart += block;
      } else {
        if (currentPart) parts.push(currentPart);
        currentPart = block;
      }
    }
    
    if (currentPart) parts.push(currentPart);
  } else {
    // Fallback: simple split
    for (let i = 0; i < text.length; i += maxLength) {
      parts.push(text.substring(i, i + maxLength));
    }
  }
  
  console.log(`📦 Split into ${parts.length} parts`);
  return parts;
}

async function extractQuestionsFromText(text) {
  try {
    console.log(`🤖 Calling GPT-4 to extract all questions...`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في قراءة وإعادة كتابة أسئلة الامتحانات بدقة عالية. استخرج كل الأسئلة بالضبط كما هي.'
        },
        {
          role: 'user',
          content: `${SIMPLE_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.1, // Very low for accuracy
      max_tokens: 16000 // Large output
    });

    const response = completion.choices[0].message.content;
    console.log(`📦 Received response: ${response.length} chars`);
    
    // Parse JSON
    let questions = [];
    try {
      let clean = response.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      
      const parsed = JSON.parse(clean);
      questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (e) {
      console.error('JSON parse error, trying fallback...');
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          questions = JSON.parse(match[0]);
        } catch (e2) {
          console.error('Fallback parse failed');
        }
      }
    }

    const validated = validateQuestions(questions);
    console.log(`✅ Extracted ${validated.length} questions`);
    
    return validated;
    
  } catch (error) {
    console.error('Error extracting questions:', error);
    return [];
  }
}

// ====================================
// Simple Validation - Just basics
// ====================================

function validateQuestions(questions) {
  if (!Array.isArray(questions)) {
    console.error('Not an array');
    return [];
  }

  const validated = questions.filter(q => {
    // Basic checks only
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 5) {
      return false;
    }
    
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return false;
    }
    
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct >= q.options.length) {
      return false;
    }
    
    // Clean
    q.question = q.question.trim();
    q.options = q.options.map(o => String(o).trim());
    if (q.chapter) q.chapter = String(q.chapter).trim();
    
    return true;
  });

  if (validated.length !== questions.length) {
    console.log(`⚠️ Filtered out ${questions.length - validated.length} invalid questions`);
  }

  return validated;
}

// ====================================
// API Routes
// ====================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server running',
    model: OPENAI_MODEL,
    version: '4.1-SIMPLE'
  });
});

app.get('/api/progress/:requestId', (req, res) => {
  res.json(getProgress(req.params.requestId));
});

app.post('/api/quiz-from-pdf', upload.single('file'), async (req, res) => {
  const start = Date.now();
  const reqId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم رفع ملف' });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 V4.1 SIMPLE [${reqId}]`);
    console.log(`📄 File: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع الملف...');
    await new Promise(r => setTimeout(r, 500));
    
    updateProgress(reqId, 30, 'استخراج النص من PDF...');
    const text = await extractTextFromPDF(req.file.buffer);
    
    if (!text || text.length < 100) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ'
      });
    }

    console.log(`📝 Extracted ${text.length} characters`);

    updateProgress(reqId, 50, 'إرسال لـ GPT-4 للقراءة...');
    const questions = await extractAllQuestions(text, reqId);

    if (!questions || questions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة في الملف'
      });
    }

    updateProgress(reqId, 95, 'إنهاء...');
    
    const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))];
    const time = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ SUCCESS: ${questions.length} questions in ${time}s`);
    console.log(`${'='.repeat(60)}\n`);

    updateProgress(reqId, 100, 'تم بنجاح! ✅');
    setTimeout(() => clearProgress(reqId), 5000);

    res.json({
      success: true,
      requestId: reqId,
      totalQuestions: questions.length,
      chapters: chapters,
      questions: questions,
      processingTime: `${time}s`
    });

  } catch (error) {
    console.error(`❌ [${reqId}]:`, error);
    clearProgress(reqId);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `حجم الملف أكبر من ${MAX_PDF_SIZE_MB}MB`
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'حدث خطأ أثناء المعالجة'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AI Quiz System V4.1 ULTIMATE SIMPLE');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`📦 Max file: ${MAX_PDF_SIZE_MB}MB`);
  console.log('✨ Simple approach:');
  console.log('   - PDF → Raw text');
  console.log('   - Send all to GPT-4 directly');
  console.log('   - Extract all questions at once');
  console.log('   - No complex processing!');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
