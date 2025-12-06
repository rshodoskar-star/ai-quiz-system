// ====================================
// AI Quiz System V4.7 COMPLETE
// All fixes applied at once!
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
const CHUNK_SIZE = 10000; // FIX 1: Reduced from 50000 to 10000

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
// PASS 1: Extract EVERYTHING
// ====================================

const EXTRACT_ALL_PROMPT = `استخرج جميع أسئلة الاختيار من متعدد من النص التالي.

القواعد:
1. استخرج كل سؤال تجده - لا تترك شيئاً
2. انسخ النص كما هو (حتى لو فيه أخطاء)
3. لا تحاول التصحيح الآن
4. فقط استخرج

يجب أن يكون الرد JSON object يحتوي على key اسمه "questions" وهو array:

{
  "questions": [
    {
      "chapter": "الفصل",
      "question": "نص السؤال كما هو",
      "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
      "correct": 0
    }
  ]
}

النص:`;

// ====================================
// PASS 2: Clean up garbled text
// ====================================

const CLEANUP_PROMPT = `أعد كتابة الأسئلة التالية بعربية صحيحة.

المهمة: صحح الأخطاء فقط، احتفظ بالمعنى.

أمثلة:
"البياهات" → "البيانات"
"همزحت" → "هندسة"
"معمليات" → "عمليات"

إذا السؤال واضح، اتركه كما هو.

يجب أن يكون الرد JSON object يحتوي على key اسمه "questions":

{
  "questions": [...]
}

الأسئلة:`;

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
// IMPROVED Smart Chunking (FIX 3)
// ====================================

function smartSplit(text, chunkSize) {
  const chunks = [];
  
  // FIX 3: Enhanced patterns for better question detection
  const questionPatterns = [
    /(?=(?:\n|^)\s*\d+[\.\):])/g,           // 1. or 1) or 1:
    /(?=(?:\n|^)\s*س\s*\d+)/g,              // س 1
    /(?=(?:\n|^)\s*سؤال\s*\d+)/g,          // سؤال 1
    /(?=(?:\n|^)\s*Q\d+)/gi,                // Q1, Q2
    /(?=(?:\n|^)\s*\(\d+\))/g,              // (1) (2)
    /(?=(?:\n|^)\s*س(?:ؤال)?\s*\d+)/g      // س 1 or سؤال 1
  ];
  
  // Try each pattern
  let bestSplit = null;
  let maxBlocks = 0;
  
  for (const pattern of questionPatterns) {
    const blocks = text.split(pattern).filter(b => b.trim());
    if (blocks.length > maxBlocks) {
      maxBlocks = blocks.length;
      bestSplit = blocks;
    }
  }
  
  // If we found good splits, use them
  if (bestSplit && bestSplit.length > 1) {
    let current = '';
    for (const block of bestSplit) {
      if ((current + block).length <= chunkSize) {
        current += block;
      } else {
        if (current) chunks.push(current.trim());
        current = block;
      }
    }
    if (current) chunks.push(current.trim());
  } else {
    // Fallback: simple split
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.substring(i, i + chunkSize));
    }
  }
  
  console.log(`📦 Split into ${chunks.length} chunks (max ${maxBlocks} blocks detected)`);
  return chunks;
}

// ====================================
// PASS 1: Extract everything with JSON mode
// ====================================

async function extractEverything(text, index, total) {
  try {
    console.log(`🔄 [PASS 1] Extracting chunk ${index + 1}/${total}`);
    
    // FIX 2: Force JSON response
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" }, // FIX 2: CRITICAL!
      messages: [
        {
          role: 'system',
          content: 'استخرج كل أسئلة الاختيار من متعدد. أخرج JSON object فقط مع key "questions".'
        },
        {
          role: 'user',
          content: `${EXTRACT_ALL_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.1,
      max_tokens: 16000
    });

    const response = completion.choices[0].message.content;
    console.log(`📥 [PASS 1] Chunk ${index + 1} response length: ${response.length}`);
    
    let questions = [];
    try {
      const parsed = JSON.parse(response);
      questions = parsed.questions || parsed.Questions || [];
      
      if (!Array.isArray(questions)) {
        console.warn(`⚠️ [PASS 1] Chunk ${index + 1}: questions is not an array`);
        questions = [];
      }
    } catch (e) {
      console.error(`❌ [PASS 1] Chunk ${index + 1}: Parse error:`, e.message);
      questions = [];
    }
    
    const validated = improvedValidate(questions); // FIX 4: Better validation
    console.log(`✅ [PASS 1] Chunk ${index + 1}: ${validated.length} questions`);
    
    return validated;
    
  } catch (error) {
    console.error(`❌ [PASS 1] Chunk ${index + 1}:`, error.message);
    return [];
  }
}

async function pass1ExtractAll(text, reqId) {
  try {
    const chunks = smartSplit(text, CHUNK_SIZE);
    
    updateProgress(reqId, 40, `المرحلة 1: استخراج من ${chunks.length} أجزاء...`);
    
    const PARALLEL_LIMIT = 3;
    const allQuestions = [];
    
    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      const progress = 40 + Math.round((i / chunks.length) * 25);
      updateProgress(reqId, progress, `استخراج... (${i + 1}-${Math.min(i + PARALLEL_LIMIT, chunks.length)}/${chunks.length})`);
      
      const promises = batch.map((chunk, idx) => 
        extractEverything(chunk, i + idx, chunks.length)
      );
      
      const results = await Promise.all(promises);
      allQuestions.push(...results.flat());
      
      if (i + PARALLEL_LIMIT < chunks.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log(`✅ [PASS 1] Total extracted: ${allQuestions.length} questions`);
    return allQuestions;
    
  } catch (error) {
    console.error('Pass 1 error:', error);
    throw error;
  }
}

// ====================================
// PASS 2: Clean up with JSON mode
// ====================================

async function cleanupQuestions(questions, reqId) {
  try {
    if (!questions || questions.length === 0) {
      console.log('⚠️ [PASS 2] No questions to clean');
      return [];
    }
    
    console.log(`🧹 [PASS 2] Cleaning ${questions.length} questions...`);
    updateProgress(reqId, 70, `المرحلة 2: تنظيف ${questions.length} سؤال...`);
    
    const BATCH_SIZE = 30;
    const cleaned = [];
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      const progress = 70 + Math.round((i / questions.length) * 20);
      updateProgress(reqId, progress, `تنظيف... (${i + 1}-${Math.min(i + BATCH_SIZE, questions.length)}/${questions.length})`);
      
      try {
        // FIX 2: Force JSON response in PASS 2 too
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          response_format: { type: "json_object" }, // FIX 2: CRITICAL!
          messages: [
            {
              role: 'system',
              content: 'أنت خبير في تصحيح الأخطاء الإملائية والترميز في النصوص العربية. أخرج JSON object مع key "questions".'
            },
            {
              role: 'user',
              content: `${CLEANUP_PROMPT}\n\n${JSON.stringify({ questions: batch }, null, 2)}`
            }
          ],
          temperature: 0.2,
          max_tokens: 16000
        });

        const response = completion.choices[0].message.content;
        
        try {
          const parsed = JSON.parse(response);
          const batchCleaned = parsed.questions || parsed.Questions || [];
          
          if (Array.isArray(batchCleaned)) {
            cleaned.push(...batchCleaned);
            console.log(`✅ [PASS 2] Cleaned batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchCleaned.length} questions`);
          } else {
            console.warn(`⚠️ [PASS 2] Batch ${Math.floor(i / BATCH_SIZE) + 1} cleanup failed, keeping original`);
            cleaned.push(...batch);
          }
        } catch (e) {
          console.error(`❌ [PASS 2] Batch ${Math.floor(i / BATCH_SIZE) + 1} parse error:`, e.message);
          cleaned.push(...batch);
        }
      } catch (error) {
        console.error(`❌ [PASS 2] Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
        cleaned.push(...batch);
      }
      
      if (i + BATCH_SIZE < questions.length) {
        await new Promise(r => setTimeout(r, 800));
      }
    }
    
    console.log(`✅ [PASS 2] Total cleaned: ${cleaned.length} questions`);
    return cleaned;
    
  } catch (error) {
    console.error('Pass 2 error:', error);
    return questions;
  }
}

// ====================================
// FIX 4: Improved Validation - More tolerant
// ====================================

function improvedValidate(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.filter(q => {
    // Basic structure
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 3) {
      return false;
    }
    
    // FIX 4: More tolerant - accept 2+ options (was 4)
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return false;
    }
    
    // FIX 4: Handle missing correct answer
    if (typeof q.correct !== 'number') {
      // Try to guess from common patterns
      if (q.correct === undefined || q.correct === null) {
        q.correct = 0; // Default to first option
        console.log(`⚠️ Fixed missing correct answer for: "${q.question.substring(0, 30)}..."`);
      } else {
        return false;
      }
    }
    
    // Validate correct index
    if (q.correct < 0 || q.correct >= q.options.length) {
      q.correct = 0; // Fix invalid index
      console.log(`⚠️ Fixed invalid correct index for: "${q.question.substring(0, 30)}..."`);
    }
    
    // Clean
    q.question = q.question.trim();
    q.options = q.options.map(o => String(o).trim()).filter(o => o.length > 0);
    
    // FIX 4: Recheck after cleaning
    if (q.options.length < 2) {
      return false;
    }
    
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
    version: '4.7-COMPLETE',
    chunkSize: CHUNK_SIZE
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
    console.log(`🚀 V4.7 COMPLETE [${reqId}]`);
    console.log(`📄 ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع الملف...');
    await new Promise(r => setTimeout(r, 300));
    
    updateProgress(reqId, 25, 'استخراج النص...');
    const text = await extractTextFromPDF(req.file.buffer);
    
    if (!text || text.length < 100) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ'
      });
    }

    console.log(`📝 Extracted ${text.length} characters`);

    // PASS 1: Extract everything
    updateProgress(reqId, 35, 'المرحلة 1: استخراج جميع الأسئلة...');
    const rawQuestions = await pass1ExtractAll(text, reqId);

    if (!rawQuestions || rawQuestions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة'
      });
    }

    console.log(`📊 Extracted ${rawQuestions.length} raw questions`);

    // PASS 2: Clean up
    updateProgress(reqId, 65, 'المرحلة 2: تنظيف النصوص...');
    const cleanQuestions = await cleanupQuestions(rawQuestions, reqId);

    updateProgress(reqId, 95, 'إنهاء...');
    
    const chapters = [...new Set(cleanQuestions.map(q => q.chapter).filter(Boolean))];
    const time = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ SUCCESS: ${cleanQuestions.length} clean questions in ${time}s`);
    console.log(`${'='.repeat(60)}\n`);

    updateProgress(reqId, 100, 'تم! ✅');
    setTimeout(() => clearProgress(reqId), 5000);

    res.json({
      success: true,
      requestId: reqId,
      totalQuestions: cleanQuestions.length,
      chapters: chapters,
      questions: cleanQuestions,
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
  console.log('🚀 AI Quiz System V4.7 COMPLETE');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log('🔧 Complete Fixes Applied:');
  console.log(`   1. CHUNK_SIZE: 50K → 10K`);
  console.log(`   2. response_format: json_object (FORCED JSON)`);
  console.log(`   3. smartSplit: Enhanced patterns`);
  console.log(`   4. Validation: More tolerant`);
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
