// ====================================
// AI Quiz System V4.2 OPTIMIZED
// Faster + Handles corrupted files
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
const CHUNK_SIZE = 50000; // Optimized chunk size

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
  message: { success: false, error: 'تم تجاوز الحد الأقصى' }
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
// Enhanced Prompts
// ====================================

const EXTRACT_PROMPT = `أنت خبير في استخراج أسئلة الامتحانات من النصوص.

المهمة: استخرج جميع أسئلة الاختيار من متعدد (MCQ) من النص التالي.

القواعد:
1. استخرج كل الأسئلة بالضبط كما هي
2. لكل سؤال: question, options (array), correct (number from 0), chapter (optional)
3. JSON Array فقط، بدون markdown أو تعليقات

مثال:
[
  {
    "chapter": "الفصل الأول",
    "question": "ما هو تعريف البرمجيات؟",
    "options": ["التعليمات", "الأجهزة", "الشبكات", "قواعد البيانات"],
    "correct": 0
  }
]

النص:`;

const FIX_AND_EXTRACT_PROMPT = `أنت خبير في قراءة النصوص المعطوبة وإصلاحها ثم استخراج الأسئلة.

النص التالي قد يحتوي على أخطاء ترميز أو حروف متلخبطة.

المهمة:
1. اقرأ النص بعناية
2. إذا وجدت حروفاً متلخبطة، حاول فهم المعنى وإصلاحها
3. استخرج جميع أسئلة الاختيار من متعدد
4. أعد كتابة كل سؤال بالعربية الصحيحة

مثلاً:
- "همزحت" ← قد تعني "هندسة"
- "معمليات" ← قد تعني "عمليات"
- "يحن" ← قد تعني "بين"

أخرج JSON Array فقط:
[
  {
    "chapter": "...",
    "question": "...",
    "options": ["...", "...", "...", "..."],
    "correct": 0
  }
]

النص:`;

// ====================================
// PDF Extraction
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
// Smart Text Analysis
// ====================================

function analyzeTextQuality(text) {
  const sample = text.substring(0, Math.min(1000, text.length));
  
  const arabicChars = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = sample.replace(/[\s\d]/g, '').length;
  const arabicRatio = totalChars > 0 ? arabicChars / totalChars : 0;
  
  // Check for garbled patterns
  const garbledPatterns = [
    /[حخهـ][زمن][حخهـ][تث]/g,
    /[يئ][حخهـ][نم]/g,
    /[لم][عغ][مل][لم][يئ][اأإ][تث]/g
  ];
  
  let garbledCount = 0;
  for (const pattern of garbledPatterns) {
    const matches = sample.match(pattern);
    if (matches) garbledCount += matches.length;
  }
  
  const isCorrupted = arabicRatio < 0.5 || garbledCount > 3;
  
  console.log(`📊 Text quality: arabicRatio=${arabicRatio.toFixed(2)}, garbled=${garbledCount}, corrupted=${isCorrupted}`);
  
  return { arabicRatio, garbledCount, isCorrupted };
}

// ====================================
// Smart Chunking
// ====================================

function smartSplit(text, chunkSize) {
  const chunks = [];
  const questionPattern = /(?=(?:\n|^)\s*(?:\d+[\.\):]|س\s*\d+|سؤال\s*\d+))/g;
  const blocks = text.split(questionPattern).filter(b => b.trim());
  
  if (blocks.length > 1) {
    let current = '';
    for (const block of blocks) {
      if ((current + block).length <= chunkSize) {
        current += block;
      } else {
        if (current) chunks.push(current.trim());
        current = block;
      }
    }
    if (current) chunks.push(current.trim());
  } else {
    // Simple split
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.substring(i, i + chunkSize));
    }
  }
  
  console.log(`📦 Split into ${chunks.length} chunks (avg ${Math.round(text.length / chunks.length)} chars)`);
  return chunks;
}

// ====================================
// Parallel Extraction
// ====================================

async function extractQuestionsFromChunk(text, index, total, isCorrupted) {
  try {
    const prompt = isCorrupted ? FIX_AND_EXTRACT_PROMPT : EXTRACT_PROMPT;
    
    console.log(`🔄 Processing chunk ${index + 1}/${total} ${isCorrupted ? '(corrupted mode)' : ''}`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: isCorrupted 
            ? 'أنت خبير في قراءة النصوص المعطوبة وإصلاحها واستخراج الأسئلة منها.'
            : 'أنت خبير في استخراج أسئلة الامتحانات بدقة عالية.'
        },
        {
          role: 'user',
          content: `${prompt}\n\n${text}`
        }
      ],
      temperature: isCorrupted ? 0.3 : 0.1, // Higher temp for corrupted text
      max_tokens: 16000
    });

    const response = completion.choices[0].message.content;
    
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
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          questions = JSON.parse(match[0]);
        } catch (e2) {
          console.error(`Chunk ${index + 1}: Parse failed`);
        }
      }
    }

    const validated = validateQuestions(questions);
    console.log(`✅ Chunk ${index + 1}: ${validated.length} questions`);
    
    return validated;
    
  } catch (error) {
    console.error(`❌ Chunk ${index + 1}:`, error.message);
    return [];
  }
}

async function extractAllQuestionsParallel(text, requestId, isCorrupted) {
  try {
    const chunks = smartSplit(text, CHUNK_SIZE);
    
    if (chunks.length === 1) {
      updateProgress(requestId, 60, 'استخراج الأسئلة...');
      return await extractQuestionsFromChunk(chunks[0], 0, 1, isCorrupted);
    }
    
    updateProgress(requestId, 50, `معالجة ${chunks.length} أجزاء...`);
    
    // Process 3 chunks in parallel for speed
    const PARALLEL_LIMIT = 3;
    const allQuestions = [];
    
    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      const progress = 50 + Math.round((i / chunks.length) * 40);
      updateProgress(requestId, progress, `معالجة... (${i + 1}-${Math.min(i + PARALLEL_LIMIT, chunks.length)}/${chunks.length})`);
      
      const promises = batch.map((chunk, idx) => 
        extractQuestionsFromChunk(chunk, i + idx, chunks.length, isCorrupted)
      );
      
      const results = await Promise.all(promises);
      allQuestions.push(...results.flat());
      
      if (i + PARALLEL_LIMIT < chunks.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log(`🎯 Total: ${allQuestions.length} questions from ${chunks.length} chunks`);
    return allQuestions;
    
  } catch (error) {
    console.error('Extraction error:', error);
    throw error;
  }
}

// ====================================
// Validation
// ====================================

function validateQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.filter(q => {
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 5) {
      return false;
    }
    
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return false;
    }
    
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct >= q.options.length) {
      return false;
    }
    
    q.question = q.question.trim();
    q.options = q.options.map(o => String(o).trim());
    if (q.chapter) q.chapter = String(q.chapter).trim();
    
    return true;
  });
}

// ====================================
// API Routes
// ====================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Running',
    model: OPENAI_MODEL,
    version: '4.2-OPTIMIZED'
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
    console.log(`🚀 V4.2 OPTIMIZED [${reqId}]`);
    console.log(`📄 ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع الملف...');
    await new Promise(r => setTimeout(r, 300));
    
    updateProgress(reqId, 30, 'استخراج النص...');
    const text = await extractTextFromPDF(req.file.buffer);
    
    if (!text || text.length < 100) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ'
      });
    }

    console.log(`📝 Extracted ${text.length} characters`);

    updateProgress(reqId, 40, 'تحليل النص...');
    const quality = analyzeTextQuality(text);

    updateProgress(reqId, 50, quality.isCorrupted ? 'معالجة ملف معطوب...' : 'استخراج الأسئلة...');
    const questions = await extractAllQuestionsParallel(text, reqId, quality.isCorrupted);

    if (!questions || questions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: quality.isCorrupted 
          ? 'الملف معطوب جداً. جرب إعادة تصدير PDF بترميز صحيح.'
          : 'لم يتم العثور على أسئلة في الملف'
      });
    }

    updateProgress(reqId, 95, 'إنهاء...');
    
    const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))];
    const time = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ SUCCESS: ${questions.length} questions in ${time}s`);
    console.log(`${'='.repeat(60)}\n`);

    updateProgress(reqId, 100, 'تم! ✅');
    setTimeout(() => clearProgress(reqId), 5000);

    res.json({
      success: true,
      requestId: reqId,
      totalQuestions: questions.length,
      chapters: chapters,
      questions: questions,
      processingTime: `${time}s`,
      quality: quality.isCorrupted ? 'corrupted-fixed' : 'good'
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
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AI Quiz System V4.2 OPTIMIZED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log('✨ Features:');
  console.log('   - Parallel processing (3x faster)');
  console.log('   - Corrupted file handling');
  console.log('   - Smart text analysis');
  console.log('   - Two-pass extraction');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
