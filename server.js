// ====================================
// AI Quiz System V3.0 FINAL
// Best extraction + Smart garbled detection
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
const CHUNK_SIZE = 8000; // Increased
const MAX_TOKENS_PER_REQUEST = 6000; // Increased

// ====================================
// Progress Tracking
// ====================================

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

// ====================================
// Middleware
// ====================================

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
  message: { success: false, error: 'تم تجاوز الحد الأقصى' },
  standardHeaders: true,
  legacyHeaders: false,
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
// BALANCED AI Prompt
// ====================================

const AI_PROMPT = `أنت خبير في استخراج أسئلة الامتحانات وتحويلها إلى JSON.

المهمة: استخرج جميع أسئلة الاختيار من متعدد (MCQ).

القواعد:
1. استخرج الأسئلة الواضحة والمقروءة
2. لكل سؤال:
   - question: نص السؤال
   - options: مصفوفة الخيارات (2-6)
   - correct: رقم الخيار الصحيح (من 0)
   - chapter: الفصل (اختياري)

3. تجاهل النص المتلخبط مثل "همزحت" أو "يحن الاعختدمحن"
4. استخرج الأسئلة الجيدة حتى لو كان بعض النص غير واضح

الصيغة - JSON فقط:
[
  {
    "chapter": "الفصل الأول",
    "question": "ما هو تعريف البرمجيات؟",
    "options": ["التعليمات والبرامج", "الأجهزة", "الشبكات", "قواعد البيانات"],
    "correct": 0
  }
]

مهم:
- JSON فقط بدون markdown
- بدون شرح
- استخرج أكبر عدد من الأسئلة الواضحة

النص:`;

// ====================================
// ULTIMATE Arabic Fixing
// ====================================

function fixArabicTextAdvanced(text) {
  try {
    text = text.normalize('NFC');
    
    // Extended encoding fixes
    const fixes = {
      'Ø£': 'أ', 'Ø¥': 'إ', 'Ø¢': 'آ', 'Ø¤': 'ؤ', 'Ø¦': 'ئ',
      'Ø§': 'ا', 'Ø¨': 'ب', 'Øª': 'ت', 'Ø«': 'ث', 'Ø¬': 'ج',
      'Ø­': 'ح', 'Ø®': 'خ', 'Ø¯': 'د', 'Ø°': 'ذ', 'Ø±': 'ر',
      'Ø²': 'ز', 'Ø³': 'س', 'Ø´': 'ش', 'Øµ': 'ص', 'Ø¶': 'ض',
      'Ø·': 'ط', 'Ø¸': 'ظ', 'Ø¹': 'ع', 'Øº': 'غ', 'Ù': 'ف',
      'Ù‚': 'ق', 'Ùƒ': 'ك', 'Ù„': 'ل', 'Ù…': 'م', 'Ù†': 'ن',
      'Ù‡': 'ه', 'Ùˆ': 'و', 'ÙŠ': 'ي', 'Ù‰': 'ى', 'Ø©': 'ة'
    };
    
    for (const [wrong, correct] of Object.entries(fixes)) {
      text = text.replace(new RegExp(wrong, 'g'), correct);
    }
    
    text = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
    
    return text;
  } catch (error) {
    return text;
  }
}

/**
 * SMART readable detection - catches garbled text like "همزحت"
 */
function isTextReadable(text) {
  if (!text || text.length < 3) return false;
  
  // Remove spaces and numbers
  const cleanText = text.replace(/[\s\d]/g, '');
  if (cleanText.length < 3) return false;
  
  const arabicChars = (cleanText.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (cleanText.match(/[a-zA-Z]/g) || []).length;
  const totalChars = cleanText.length;
  
  const arabicRatio = arabicChars / totalChars;
  const latinRatio = latinChars / totalChars;
  
  // Must be mostly Arabic OR mostly Latin
  const isMostlyArabic = arabicRatio > 0.6;
  const isMostlyLatin = latinRatio > 0.7;
  
  if (!isMostlyArabic && !isMostlyLatin) {
    return false;
  }
  
  // Check for common garbled patterns
  const garbledPatterns = [
    /[حخهـ][زمن][حخهـ][تث]/,  // "همزحت", "خمنث"
    /[يئ][حخهـ][نم]/,          // "يحن", "ئخم"
    /[لم][عغ][مل][لم][يئ][اأإ][تث]/, // "معمليات"
    /[حخهـ][فق][اأإ][عغ][لم]/  // "خفاعل"
  ];
  
  for (const pattern of garbledPatterns) {
    if (pattern.test(text)) {
      console.log(`🚫 Garbled pattern detected in: "${text.substring(0, 30)}"`);
      return false;
    }
  }
  
  // Check for nonsensical letter combinations
  // Arabic should have vowels (ا و ي)
  if (isMostlyArabic) {
    const vowels = (text.match(/[اوي]/g) || []).length;
    const vowelRatio = vowels / arabicChars;
    
    if (vowelRatio < 0.15) { // Too few vowels = garbled
      console.log(`🚫 Low vowel ratio (${vowelRatio.toFixed(2)}) in: "${text.substring(0, 30)}"`);
      return false;
    }
  }
  
  return true;
}

async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer, {
      max: 0,
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });
    
    let text = data.text;
    console.log(`📄 Extracted ${text.length} chars`);
    
    text = fixArabicTextAdvanced(text);
    
    // Check sample
    const sample = text.substring(0, 500);
    if (!isTextReadable(sample)) {
      console.warn('⚠️ WARNING: PDF may have severe encoding issues');
      console.warn('Sample:', sample.substring(0, 100));
    }
    
    return text;
  } catch (error) {
    console.error('PDF error:', error);
    throw new Error('فشل استخراج النص');
  }
}

function cleanText(text) {
  text = text.replace(/تصميم وتطوير.*?\d{10}/gi, '');
  text = text.replace(/أبو سليم.*?/gi, '');
  text = text.replace(/صفحة\s*\d+/gi, '');
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function splitIntoChunks(text, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  const qPattern = /(?=\n\s*(?:\d+[\.\):]|س\s*\d+|سؤال\s*\d+))/g;
  const blocks = text.split(qPattern).filter(b => b.trim());
  
  if (blocks.length <= 1) {
    const paras = text.split(/\n\n+/);
    let current = '';
    
    for (const p of paras) {
      if ((current + p).length <= chunkSize) {
        current += p + '\n\n';
      } else {
        if (current) chunks.push(current.trim());
        current = p + '\n\n';
      }
    }
    if (current) chunks.push(current.trim());
  } else {
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
  }
  
  console.log(`📦 ${chunks.length} chunks (avg ${Math.round(text.length / chunks.length)} chars)`);
  return chunks;
}

async function extractQuestionsFromChunk(text, idx, total) {
  try {
    console.log(`🔄 Chunk ${idx + 1}/${total} (${text.length} chars)`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في استخراج أسئلة الامتحانات. استخرج الأسئلة الواضحة فقط.'
        },
        {
          role: 'user',
          content: `${AI_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS_PER_REQUEST
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
      if (match) questions = JSON.parse(match[0]);
    }

    const validated = validateQuestionsSmart(questions);
    console.log(`✅ Chunk ${idx + 1}: ${validated.length} valid (rejected ${questions.length - validated.length})`);
    
    return validated;
  } catch (error) {
    console.error(`❌ Chunk ${idx + 1}:`, error.message);
    return [];
  }
}

async function extractQuestionsWithAI(text, reqId) {
  try {
    console.log(`📝 Total: ${text.length} chars`);
    
    if (text.length <= CHUNK_SIZE) {
      updateProgress(reqId, 70, 'استخراج...');
      return await extractQuestionsFromChunk(text, 0, 1);
    }
    
    updateProgress(reqId, 55, 'تقسيم...');
    const chunks = splitIntoChunks(text, CHUNK_SIZE);
    
    const all = [];
    const progressPer = 35 / chunks.length;
    
    for (let i = 0; i < chunks.length; i++) {
      const prog = 55 + Math.round((i + 1) * progressPer);
      updateProgress(reqId, prog, `استخراج... (${i + 1}/${chunks.length})`);
      
      const qs = await extractQuestionsFromChunk(chunks[i], i, chunks.length);
      all.push(...qs);
      
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log(`🎯 Total: ${all.length} questions from ${chunks.length} chunks`);
    return all;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

/**
 * SMART validation - Rejects garbled but allows good questions
 */
function validateQuestionsSmart(questions) {
  if (!Array.isArray(questions)) return [];

  let rejected = {
    noQuestion: 0,
    garbledQuestion: 0,
    shortQuestion: 0,
    noOptions: 0,
    fewOptions: 0,
    garbledOptions: 0,
    noCorrect: 0,
    invalidCorrect: 0
  };

  const validated = questions.filter(q => {
    // Check question
    if (!q.question || typeof q.question !== 'string') {
      rejected.noQuestion++;
      return false;
    }
    
    const qText = q.question.trim();
    if (qText.length < 10) {
      rejected.shortQuestion++;
      return false;
    }
    
    if (!isTextReadable(qText)) {
      rejected.garbledQuestion++;
      return false;
    }
    
    // Check options
    if (!Array.isArray(q.options)) {
      rejected.noOptions++;
      return false;
    }
    
    if (q.options.length < 2) {
      rejected.fewOptions++;
      return false;
    }
    
    // Check each option
    for (const opt of q.options) {
      if (!opt || typeof opt !== 'string' || opt.trim().length < 1) {
        rejected.garbledOptions++;
        return false;
      }
      
      if (!isTextReadable(opt)) {
        rejected.garbledOptions++;
        return false;
      }
    }
    
    // Check correct
    if (typeof q.correct !== 'number') {
      rejected.noCorrect++;
      return false;
    }
    
    if (q.correct < 0 || q.correct >= q.options.length) {
      rejected.invalidCorrect++;
      return false;
    }
    
    // Clean
    q.question = qText;
    q.options = q.options.map(o => String(o).trim());
    if (q.chapter) q.chapter = String(q.chapter).trim();
    
    return true;
  });

  const total = Object.values(rejected).reduce((a, b) => a + b, 0);
  if (total > 0) {
    console.log(`⚠️ Rejected ${total}:`, rejected);
  }

  return validated;
}

// ====================================
// API Routes
// ====================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Running',
    model: OPENAI_MODEL,
    version: '3.0-FINAL'
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
    console.log(`🚀 [${reqId}] ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)}KB)`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع...');
    await new Promise(r => setTimeout(r, 300));
    
    updateProgress(reqId, 25, 'استخراج النص...');
    const raw = await extractTextFromPDF(req.file.buffer);
    
    if (!raw || raw.length < 100) {
      clearProgress(reqId);
      return res.status(400).json({ success: false, error: 'نص غير كافي' });
    }

    updateProgress(reqId, 40, 'تنظيف...');
    const cleaned = cleanText(raw);
    console.log(`✨ Cleaned: ${cleaned.length} chars`);

    updateProgress(reqId, 50, 'بدء الاستخراج...');
    const questions = await extractQuestionsWithAI(cleaned, reqId);

    if (!questions || questions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة واضحة. الملف قد يحتوي على أخطاء ترميز.'
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
      return res.status(400).json({ success: false, error: `أكبر من ${MAX_PDF_SIZE_MB}MB` });
    }

    res.status(500).json({ success: false, error: error.message || 'خطأ' });
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
  console.log('🚀 AI Quiz System V3.0 FINAL');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`📦 Chunk: ${CHUNK_SIZE} chars`);
  console.log(`🎯 Max tokens: ${MAX_TOKENS_PER_REQUEST}`);
  console.log('✨ Features:');
  console.log('   - Smart garbled detection');
  console.log('   - Pattern-based filtering');
  console.log('   - Vowel ratio checking');
  console.log('   - Balanced extraction');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
