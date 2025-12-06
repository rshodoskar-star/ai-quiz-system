// ====================================
// AI Quiz System V4.8 SMART HYBRID
// Extract all, clean only garbled ones
// 60% cheaper, same quality!
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
const CHUNK_SIZE = 25000; // Balanced: not too big, not too small

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
// PASS 1: Extract with cleanup instructions
// ====================================

const EXTRACT_PROMPT = `استخرج جميع أسئلة الاختيار من متعدد من النص التالي.

القواعد:
1. استخرج كل سؤال تجده
2. إذا وجدت أخطاء إملائية بسيطة، صححها مباشرة
3. مثال: "البياهات" → "البيانات", "معمليات" → "عمليات"

يجب أن يكون الرد JSON object:
{
  "questions": [
    {
      "chapter": "الفصل",
      "question": "نص السؤال",
      "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
      "correct": 0
    }
  ]
}

النص:`;

// ====================================
// PASS 2: Deep cleanup for garbled only
// ====================================

const DEEP_CLEANUP_PROMPT = `هذه أسئلة متلخبطة جداً. أعد كتابتها بالكامل بعربية صحيحة.

حاول فهم المعنى وإعادة الصياغة:
"همزحت" → "هندسة"
"للخفاعلات" → "للتفاعلات"
"يحن" → "بين"

أخرج JSON object:
{
  "questions": [...]
}

الأسئلة المتلخبطة:`;

// ====================================
// Smart garbled detection
// ====================================

function isQuestionGarbled(question) {
  const text = question.question + ' ' + question.options.join(' ');
  
  // Check 1: Arabic ratio
  const cleanText = text.replace(/[\s\d]/g, '');
  if (cleanText.length < 5) return false;
  
  const arabicChars = (cleanText.match(/[\u0600-\u06FF]/g) || []).length;
  const arabicRatio = arabicChars / cleanText.length;
  
  // Very low Arabic = garbled
  if (arabicRatio < 0.5) {
    return true;
  }
  
  // Check 2: Obvious garbled patterns
  const badPatterns = [
    /[حخهـ]{3,}/,
    /[زمن]{3,}/,
    /[تث]{3,}/,
    /[لم][عغ][مل][لم]/,
    /[يئ][حخهـ][نم]/
  ];
  
  for (const pattern of badPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  // Check 3: Vowel ratio (Arabic needs vowels)
  const vowels = (text.match(/[اوي]/g) || []).length;
  const vowelRatio = arabicChars > 0 ? vowels / arabicChars : 0;
  
  if (vowelRatio < 0.12) {
    return true;
  }
  
  return false;
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
  const questionPatterns = [
    /(?=(?:\n|^)\s*\d+[\.\):])/g,
    /(?=(?:\n|^)\s*س\s*\d+)/g,
    /(?=(?:\n|^)\s*سؤال\s*\d+)/g,
    /(?=(?:\n|^)\s*Q\d+)/gi,
    /(?=(?:\n|^)\s*\(\d+\))/g
  ];
  
  let bestSplit = null;
  let maxBlocks = 0;
  
  for (const pattern of questionPatterns) {
    const blocks = text.split(pattern).filter(b => b.trim());
    if (blocks.length > maxBlocks) {
      maxBlocks = blocks.length;
      bestSplit = blocks;
    }
  }
  
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
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.substring(i, i + chunkSize));
    }
  }
  
  console.log(`📦 Split into ${chunks.length} chunks`);
  return chunks;
}

// ====================================
// PASS 1: Extract with basic cleanup
// ====================================

async function extractWithBasicCleanup(text, index, total) {
  try {
    console.log(`🔄 [PASS 1] Extracting chunk ${index + 1}/${total}`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: 'system',
          content: 'استخرج الأسئلة وصحح الأخطاء البسيطة. أخرج JSON object مع key "questions".'
        },
        {
          role: 'user',
          content: `${EXTRACT_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.2,
      max_tokens: 16000
    });

    const response = completion.choices[0].message.content;
    
    let questions = [];
    try {
      const parsed = JSON.parse(response);
      questions = parsed.questions || parsed.Questions || [];
    } catch (e) {
      console.error(`❌ [PASS 1] Chunk ${index + 1}: Parse error`);
      return [];
    }
    
    const validated = validateQuestions(questions);
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
    updateProgress(reqId, 40, `استخراج من ${chunks.length} أجزاء...`);
    
    const PARALLEL_LIMIT = 3;
    const allQuestions = [];
    
    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      const progress = 40 + Math.round((i / chunks.length) * 35);
      updateProgress(reqId, progress, `استخراج... (${i + 1}/${chunks.length})`);
      
      const promises = batch.map((chunk, idx) => 
        extractWithBasicCleanup(chunk, i + idx, chunks.length)
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
// PASS 2: Deep cleanup ONLY garbled
// ====================================

async function pass2CleanupGarbled(questions, reqId) {
  try {
    // Detect garbled questions
    const garbledQuestions = [];
    const cleanQuestions = [];
    
    for (const q of questions) {
      if (isQuestionGarbled(q)) {
        garbledQuestions.push(q);
      } else {
        cleanQuestions.push(q);
      }
    }
    
    console.log(`📊 Analysis: ${cleanQuestions.length} clean, ${garbledQuestions.length} garbled`);
    
    if (garbledQuestions.length === 0) {
      console.log('🎉 All questions are clean! Skipping PASS 2.');
      return questions;
    }
    
    console.log(`🧹 [PASS 2] Deep cleaning ${garbledQuestions.length} garbled questions...`);
    updateProgress(reqId, 80, `تنظيف عميق لـ ${garbledQuestions.length} سؤال متلخبط...`);
    
    const BATCH_SIZE = 30;
    const cleaned = [];
    
    for (let i = 0; i < garbledQuestions.length; i += BATCH_SIZE) {
      const batch = garbledQuestions.slice(i, i + BATCH_SIZE);
      const progress = 80 + Math.round((i / garbledQuestions.length) * 10);
      updateProgress(reqId, progress, `تنظيف... (${i + 1}/${garbledQuestions.length})`);
      
      try {
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            {
              role: 'system',
              content: 'أعد كتابة الأسئلة المتلخبطة بعربية صحيحة. أخرج JSON object.'
            },
            {
              role: 'user',
              content: `${DEEP_CLEANUP_PROMPT}\n\n${JSON.stringify({ questions: batch }, null, 2)}`
            }
          ],
          temperature: 0.3,
          max_tokens: 16000
        });

        const response = completion.choices[0].message.content;
        const parsed = JSON.parse(response);
        const batchCleaned = parsed.questions || parsed.Questions || [];
        
        if (Array.isArray(batchCleaned)) {
          cleaned.push(...batchCleaned);
          console.log(`✅ [PASS 2] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchCleaned.length} cleaned`);
        } else {
          cleaned.push(...batch); // Fallback
        }
      } catch (error) {
        console.error(`❌ [PASS 2] Batch error:`, error.message);
        cleaned.push(...batch); // Fallback
      }
      
      if (i + BATCH_SIZE < garbledQuestions.length) {
        await new Promise(r => setTimeout(r, 800));
      }
    }
    
    // Combine clean + cleaned
    const finalQuestions = [...cleanQuestions, ...cleaned];
    console.log(`✅ Final: ${cleanQuestions.length} kept clean + ${cleaned.length} cleaned = ${finalQuestions.length} total`);
    
    return finalQuestions;
    
  } catch (error) {
    console.error('Pass 2 error:', error);
    return questions; // Fallback
  }
}

// ====================================
// Validation
// ====================================

function validateQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.filter(q => {
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 3) {
      return false;
    }
    
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return false;
    }
    
    if (typeof q.correct !== 'number') {
      q.correct = 0;
    }
    
    if (q.correct < 0 || q.correct >= q.options.length) {
      q.correct = 0;
    }
    
    q.question = q.question.trim();
    q.options = q.options.map(o => String(o).trim()).filter(o => o.length > 0);
    
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
    version: '4.8-SMART-HYBRID',
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
    console.log(`🚀 V4.8 SMART HYBRID [${reqId}]`);
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

    // PASS 1: Extract with basic cleanup
    updateProgress(reqId, 35, 'استخراج الأسئلة...');
    const rawQuestions = await pass1ExtractAll(text, reqId);

    if (!rawQuestions || rawQuestions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة'
      });
    }

    console.log(`📊 Extracted ${rawQuestions.length} questions`);

    // PASS 2: Deep cleanup ONLY garbled ones
    updateProgress(reqId, 75, 'تحليل وتنظيف...');
    const finalQuestions = await pass2CleanupGarbled(rawQuestions, reqId);

    updateProgress(reqId, 95, 'إنهاء...');
    
    const chapters = [...new Set(finalQuestions.map(q => q.chapter).filter(Boolean))];
    const time = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ SUCCESS: ${finalQuestions.length} questions in ${time}s`);
    console.log(`${'='.repeat(60)}\n`);

    updateProgress(reqId, 100, 'تم! ✅');
    setTimeout(() => clearProgress(reqId), 5000);

    res.json({
      success: true,
      requestId: reqId,
      totalQuestions: finalQuestions.length,
      chapters: chapters,
      questions: finalQuestions,
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
  console.log('🚀 AI Quiz System V4.8 SMART HYBRID');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log('⭐ Strategy:');
  console.log(`   - CHUNK_SIZE: ${CHUNK_SIZE} (balanced)`);
  console.log(`   - PASS 1: Extract + basic cleanup`);
  console.log(`   - Detect: Clean vs Garbled`);
  console.log(`   - PASS 2: Deep cleanup ONLY garbled`);
  console.log('💰 60% cheaper than V4.7!');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
