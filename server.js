// ====================================
// AI Quiz System V4.6 FIXED
// Fixes: requestId typo + Better JSON parsing
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
// PASS 1: Extract EVERYTHING
// ====================================

const EXTRACT_ALL_PROMPT = `استخرج جميع أسئلة الاختيار من متعدد من النص التالي.

القواعد:
1. استخرج كل سؤال تجده - لا تترك شيئاً
2. انسخ النص كما هو (حتى لو فيه أخطاء)
3. لا تحاول التصحيح الآن
4. فقط استخرج

JSON Array فقط - بدون أي نص إضافي:
[
  {
    "chapter": "الفصل",
    "question": "نص السؤال كما هو",
    "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
    "correct": 0
  }
]

مهم جداً: أخرج JSON فقط، بدون markdown، بدون تعليقات، بدون نص إضافي.

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

أخرج نفس الصيغة - JSON Array فقط بدون أي نص إضافي:`;

// ====================================
// IMPROVED JSON Parsing
// ====================================

function parseJSONRobust(text) {
  // Try multiple parsing strategies
  
  // Strategy 1: Direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    // Continue to next strategy
  }
  
  // Strategy 2: Remove markdown
  try {
    let clean = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(clean);
  } catch (e) {
    // Continue
  }
  
  // Strategy 3: Extract array with regex
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    // Continue
  }
  
  // Strategy 4: Find first [ and last ]
  try {
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      const jsonStr = text.substring(firstBracket, lastBracket + 1);
      return JSON.parse(jsonStr);
    }
  } catch (e) {
    // Continue
  }
  
  // Strategy 5: Remove common prefixes/suffixes
  try {
    let cleaned = text
      .replace(/^.*?(\[)/s, '$1')  // Remove everything before first [
      .replace(/(\]).*?$/s, '$1'); // Remove everything after last ]
    return JSON.parse(cleaned);
  } catch (e) {
    // All strategies failed
  }
  
  return null;
}

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
// PASS 1: Extract everything
// ====================================

async function extractEverything(text, index, total) {
  try {
    console.log(`🔄 [PASS 1] Extracting chunk ${index + 1}/${total}`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'استخرج كل أسئلة الاختيار من متعدد. أخرج JSON Array فقط بدون أي نص إضافي.'
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
    console.log(`📥 [PASS 1] Chunk ${index + 1} response: ${response.substring(0, 100)}...`);
    
    // Use robust parsing
    const parsed = parseJSONRobust(response);
    
    if (!parsed) {
      console.error(`❌ [PASS 1] Chunk ${index + 1}: All parse strategies failed`);
      return [];
    }
    
    const questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    const validated = simpleValidate(questions);
    
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
// PASS 2: Clean up
// ====================================

async function cleanupQuestions(questions, reqId) {
  try {
    if (!questions || questions.length === 0) {
      console.log('⚠️ [PASS 2] No questions to clean');
      return [];
    }
    
    console.log(`🧹 [PASS 2] Cleaning ${questions.length} questions...`);
    updateProgress(reqId, 70, `المرحلة 2: تنظيف ${questions.length} سؤال...`);
    
    // Process in batches of 30
    const BATCH_SIZE = 30;
    const cleaned = [];
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      const progress = 70 + Math.round((i / questions.length) * 20);
      updateProgress(reqId, progress, `تنظيف... (${i + 1}-${Math.min(i + BATCH_SIZE, questions.length)}/${questions.length})`);
      
      try {
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: [
            {
              role: 'system',
              content: 'أنت خبير في تصحيح الأخطاء الإملائية والترميز في النصوص العربية. أخرج JSON فقط.'
            },
            {
              role: 'user',
              content: `${CLEANUP_PROMPT}\n\n${JSON.stringify(batch, null, 2)}`
            }
          ],
          temperature: 0.2,
          max_tokens: 16000
        });

        const response = completion.choices[0].message.content;
        
        // Use robust parsing
        const parsed = parseJSONRobust(response);
        
        if (parsed) {
          const batchCleaned = Array.isArray(parsed) ? parsed : (parsed.questions || []);
          cleaned.push(...batchCleaned);
          console.log(`✅ [PASS 2] Cleaned batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchCleaned.length} questions`);
        } else {
          console.warn(`⚠️ [PASS 2] Batch ${Math.floor(i / BATCH_SIZE) + 1} cleanup failed, keeping original`);
          cleaned.push(...batch);
        }
      } catch (error) {
        console.error(`❌ [PASS 2] Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
        cleaned.push(...batch); // Fallback to original
      }
      
      if (i + BATCH_SIZE < questions.length) {
        await new Promise(r => setTimeout(r, 800));
      }
    }
    
    console.log(`✅ [PASS 2] Total cleaned: ${cleaned.length} questions`);
    return cleaned;
    
  } catch (error) {
    console.error('Pass 2 error:', error);
    return questions; // Return original if cleanup fails
  }
}

// ====================================
// Simple Validation - Only structure
// ====================================

function simpleValidate(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.filter(q => {
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 3) {
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
    version: '4.6-FIXED'
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
    console.log(`🚀 V4.6 FIXED [${reqId}]`);
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
    const cleanQuestions = await cleanupQuestions(rawQuestions, reqId); // FIXED: was requestId

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
  console.log('🚀 AI Quiz System V4.6 FIXED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log('✨ Fixes:');
  console.log('   - Fixed requestId typo → reqId');
  console.log('   - Robust JSON parsing (5 strategies)');
  console.log('   - Better error handling');
  console.log('   - Safe fallbacks');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
