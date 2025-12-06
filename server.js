// ====================================
// AI Quiz System V4.4 BALANCED
// Best of all worlds: Clean text + High count
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
const CHUNK_SIZE = 50000;

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
// BALANCED Prompt - Clean but comprehensive
// ====================================

const BALANCED_PROMPT = `أنت خبير في استخراج أسئلة الامتحانات وإعادة صياغتها بشكل احترافي.

المهمة:
1. استخرج جميع أسئلة الاختيار من متعدد من النص
2. إذا وجدت أخطاء إملائية أو ترميز، صححها بهدوء
3. أعد صياغة الأسئلة بشكل واضح ومفهوم
4. احتفظ بالمعنى الأصلي

أمثلة على التصحيح البسيط:
- "البياهات" → "البيانات"
- "معمليات" → "عمليات"
- "يحن" → "بين"

القواعد:
- استخرج كل الأسئلة (لا تترك شيئاً)
- صحح الأخطاء البسيطة
- إذا السؤال واضح، اتركه كما هو
- إذا فيه أخطاء، صححها

الصيغة - JSON Array:
[
  {
    "chapter": "اسم الفصل",
    "question": "نص السؤال واضح",
    "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
    "correct": 0
  }
]

JSON فقط، بدون markdown.

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
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.substring(i, i + chunkSize));
    }
  }
  
  console.log(`📦 Split into ${chunks.length} chunks`);
  return chunks;
}

// ====================================
// Extract with balanced approach
// ====================================

async function extractWithBalance(text, index, total) {
  try {
    console.log(`🔄 Processing chunk ${index + 1}/${total}`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في استخراج الأسئلة وتصحيح الأخطاء البسيطة. استخرج كل الأسئلة وصحح الأخطاء بدون مبالغة.'
        },
        {
          role: 'user',
          content: `${BALANCED_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.2, // Balanced
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

    const validated = validateBalanced(questions);
    console.log(`✅ Chunk ${index + 1}: ${validated.valid.length} valid, ${validated.rejected} rejected`);
    
    return validated.valid;
    
  } catch (error) {
    console.error(`❌ Chunk ${index + 1}:`, error.message);
    return [];
  }
}

async function extractAllQuestionsParallel(text, requestId) {
  try {
    const chunks = smartSplit(text, CHUNK_SIZE);
    
    if (chunks.length === 1) {
      updateProgress(requestId, 60, 'استخراج وتصحيح الأسئلة...');
      return await extractWithBalance(chunks[0], 0, 1);
    }
    
    updateProgress(requestId, 50, `معالجة ${chunks.length} أجزاء...`);
    
    const PARALLEL_LIMIT = 3;
    const allQuestions = [];
    
    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      const progress = 50 + Math.round((i / chunks.length) * 40);
      updateProgress(requestId, progress, `معالجة... (${i + 1}-${Math.min(i + PARALLEL_LIMIT, chunks.length)}/${chunks.length})`);
      
      const promises = batch.map((chunk, idx) => 
        extractWithBalance(chunk, i + idx, chunks.length)
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
// Balanced Validation - Not too strict
// ====================================

function hasObviousGarbled(text) {
  if (!text || text.length < 3) return true;
  
  // Only reject VERY obvious garbled patterns
  const veryBadPatterns = [
    /[حخ]{3,}/,  // 3+ consecutive similar letters
    /[زمن]{3,}/,
    /[تث]{3,}/,
    /[\u0600-\u06FF]{2}[^اويةأإآىئؤ\s]{8,}[\u0600-\u06FF]{2}/ // Long sequence without vowels
  ];
  
  for (const pattern of veryBadPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  // Check if text is mostly non-Arabic
  const cleanText = text.replace(/[\s\d]/g, '');
  if (cleanText.length < 3) return false;
  
  const arabicChars = (cleanText.match(/[\u0600-\u06FF]/g) || []).length;
  const arabicRatio = arabicChars / cleanText.length;
  
  // Only reject if very low Arabic ratio
  if (arabicRatio < 0.4) {
    return true;
  }
  
  return false;
}

function validateBalanced(questions) {
  if (!Array.isArray(questions)) {
    return { valid: [], rejected: 0 };
  }

  let rejected = 0;
  const valid = questions.filter(q => {
    // Basic structure check
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 5) {
      rejected++;
      return false;
    }
    
    if (!Array.isArray(q.options) || q.options.length < 2) {
      rejected++;
      return false;
    }
    
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct >= q.options.length) {
      rejected++;
      return false;
    }
    
    // Only reject VERY obvious garbled text
    if (hasObviousGarbled(q.question)) {
      console.log(`🚫 Rejected very garbled question: "${q.question.substring(0, 50)}"`);
      rejected++;
      return false;
    }
    
    // Check options - only very bad ones
    let badOptions = 0;
    for (const opt of q.options) {
      if (!opt || typeof opt !== 'string' || opt.trim().length < 1) {
        badOptions++;
      } else if (hasObviousGarbled(opt)) {
        badOptions++;
      }
    }
    
    if (badOptions > q.options.length / 2) {
      console.log(`🚫 Rejected question with too many bad options`);
      rejected++;
      return false;
    }
    
    // Clean
    q.question = q.question.trim();
    q.options = q.options.map(o => String(o).trim());
    if (q.chapter) q.chapter = String(q.chapter).trim();
    
    return true;
  });

  if (rejected > 0) {
    console.log(`⚠️ Validation: ${valid.length} accepted, ${rejected} rejected`);
  }

  return { valid, rejected };
}

// ====================================
// API Routes
// ====================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Running',
    model: OPENAI_MODEL,
    version: '4.4-BALANCED'
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
    console.log(`🚀 V4.4 BALANCED [${reqId}]`);
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

    updateProgress(reqId, 45, 'استخراج وتصحيح الأسئلة...');
    const questions = await extractAllQuestionsParallel(text, reqId);

    if (!questions || questions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة'
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
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AI Quiz System V4.4 BALANCED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log('✨ Features:');
  console.log('   - Balanced approach: Clean + Comprehensive');
  console.log('   - Mild correction (not too aggressive)');
  console.log('   - Reasonable validation (not too strict)');
  console.log('   - Best quality/quantity ratio');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
