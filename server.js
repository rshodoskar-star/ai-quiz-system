// ====================================
// AI Quiz System - Backend Server V2.2 FIXED
// FIXED: Syntax error in AI_PROMPT
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

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_PDF_SIZE_MB = parseInt(process.env.MAX_PDF_SIZE_MB) || 50;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;
const CHUNK_SIZE = 6000;
const MAX_TOKENS_PER_REQUEST = 5000;

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
  message: {
    success: false,
    error: 'تم تجاوز الحد الأقصى للطلبات. الرجاء المحاولة لاحقاً.'
  },
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
      cb(new Error('يجب أن يكون الملف من نوع PDF فقط'));
    }
  }
});

// ====================================
// AI Prompt - FIXED (no backticks inside)
// ====================================

const AI_PROMPT = `أنت خبير في استخراج وتحويل أسئلة الامتحانات إلى صيغة JSON.

المهمة:
استخرج جميع أسئلة الاختيار من متعدد (MCQ) من النص التالي وحولها إلى JSON.

قواعد مهمة:
1. استخرج فقط الأسئلة الواضحة والمقروءة - إذا كان النص متلخبط أو غير مفهوم، تجاهله
2. لكل سؤال يجب أن يحتوي على:
   - question: نص السؤال (نص واضح ومقروء)
   - options: مصفوفة من الخيارات (2-6 خيارات)
   - correct: رقم الخيار الصحيح (يبدأ من 0)
   - chapter: اسم الفصل (اختياري)

3. إذا وجدت نص غير واضح مثل "يغعلل م ص" أو حروف متلخبطة، لا تستخرجه
4. تأكد أن كل خيار واضح ومفهوم
5. رقم الإجابة الصحيحة يجب أن يكون ضمن عدد الخيارات

الصيغة المطلوبة - JSON فقط:
[
  {
    "chapter": "الفصل الأول",
    "question": "ما هو تعريف البرمجيات؟",
    "options": [
      "مجموعة من التعليمات والبرامج",
      "الأجهزة المادية",
      "الشبكات",
      "قواعد البيانات"
    ],
    "correct": 0
  }
]

مهم جداً:
- JSON فقط بدون أي نص إضافي
- بدون markdown او backticks
- بدون شرح
- استخرج فقط الأسئلة الواضحة والمقروءة

النص:`;

// ====================================
// Arabic Text Fixing
// ====================================

function fixArabicTextUltimate(text) {
  try {
    text = text.normalize('NFC');
    
    const encodingFixes = {
      'Ø£': 'أ', 'Ø¥': 'إ', 'Ø¢': 'آ', 'Ø¤': 'ؤ', 'Ø¦': 'ئ',
      'Ø§': 'ا', 'Ø¨': 'ب', 'Øª': 'ت', 'Ø«': 'ث', 'Ø¬': 'ج',
      'Ø­': 'ح', 'Ø®': 'خ', 'Ø¯': 'د', 'Ø°': 'ذ', 'Ø±': 'ر',
      'Ø²': 'ز', 'Ø³': 'س', 'Ø´': 'ش', 'Øµ': 'ص', 'Ø¶': 'ض',
      'Ø·': 'ط', 'Ø¸': 'ظ', 'Ø¹': 'ع', 'Øº': 'غ', 'Ù': 'ف',
      'Ù‚': 'ق', 'Ùƒ': 'ك', 'Ù„': 'ل', 'Ù…': 'م', 'Ù†': 'ن',
      'Ù‡': 'ه', 'Ùˆ': 'و', 'ÙŠ': 'ي', 'Ù‰': 'ى', 'Ø©': 'ة'
    };
    
    for (const [wrong, correct] of Object.entries(encodingFixes)) {
      text = text.replace(new RegExp(wrong, 'g'), correct);
    }
    
    text = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
    text = text.replace(/[àáâãäå]/g, 'ا');
    text = text.replace(/[èéêë]/g, 'ه');
    text = text.replace(/[ìíîï]/g, 'ي');
    text = text.replace(/[òóôõö]/g, 'و');
    
    return text;
  } catch (error) {
    console.error('Error fixing text:', error);
    return text;
  }
}

function isReadableArabic(text) {
  if (!text || text.length < 3) return false;
  
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  
  if (totalChars === 0) return false;
  
  const arabicRatio = arabicChars / totalChars;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const latinRatio = latinChars / totalChars;
  
  return arabicRatio > 0.4 || latinRatio > 0.6;
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
    
    text = fixArabicTextUltimate(text);
    
    const sample = text.substring(0, Math.min(500, text.length));
    if (!isReadableArabic(sample)) {
      console.warn('⚠️ Text may have encoding issues');
    }
    
    return text;
  } catch (error) {
    console.error('PDF error:', error);
    throw new Error('فشل استخراج النص من PDF');
  }
}

function cleanText(text) {
  text = text.replace(/تصميم وتطوير ال[رب]مجيات.*?\d{10}/gi, '');
  text = text.replace(/أبو سليم للخدمات الطالبية.*?/gi, '');
  text = text.replace(/صفحة\s*\d+/gi, '');
  text = text.replace(/\d+\s*\/\s*\d+/g, '');
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function splitIntoChunks(text, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  const questionPattern = /(?=\n\s*(?:\d+[\.\):]|\([أابتث]\)|س\s*\d+|سؤال\s*\d+))/g;
  const questionBlocks = text.split(questionPattern).filter(b => b.trim());
  
  if (questionBlocks.length <= 1) {
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    
    for (const p of paragraphs) {
      if ((currentChunk + p).length <= chunkSize) {
        currentChunk += p + '\n\n';
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = p + '\n\n';
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
  } else {
    let currentChunk = '';
    for (const block of questionBlocks) {
      if ((currentChunk + block).length <= chunkSize) {
        currentChunk += block;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = block;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
  }
  
  console.log(`📦 ${chunks.length} chunks`);
  return chunks;
}

async function extractQuestionsFromChunk(text, chunkIndex, totalChunks) {
  let questions = [];
  try {
    console.log(`🔄 Chunk ${chunkIndex + 1}/${totalChunks}`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في استخراج أسئلة الامتحانات. استخرج فقط الأسئلة الواضحة.'
        },
        {
          role: 'user',
          content: `${AI_PROMPT}\n\n${text}`
        }
      ],
      temperature: 0.2,
      max_tokens: MAX_TOKENS_PER_REQUEST
    });

    const response = completion.choices[0].message.content;
    
    try {
      let cleaned = response.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      
      const parsed = JSON.parse(cleaned);
      questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (e) {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      }
    }

    const validated = validateQuestionsStrict(questions);
    console.log(`✅ Chunk ${chunkIndex + 1}: ${validated.length} valid (rejected ${questions.length - validated.length})`);
    
    return validated;
  } catch (error) {
    console.error(`❌ Chunk ${chunkIndex + 1}:`, error.message);
    return [];
  }
}

async function extractQuestionsWithAI(text, requestId) {
  try {
    console.log(`📝 ${text.length} chars`);
    
    if (text.length <= CHUNK_SIZE) {
      updateProgress(requestId, 70, 'استخراج الأسئلة...');
      return await extractQuestionsFromChunk(text, 0, 1);
    }
    
    updateProgress(requestId, 55, 'تقسيم...');
    const chunks = splitIntoChunks(text, CHUNK_SIZE);
    
    const allQuestions = [];
    const progressPerChunk = 35 / chunks.length;
    
    for (let i = 0; i < chunks.length; i++) {
      const progress = 55 + Math.round((i + 1) * progressPerChunk);
      updateProgress(requestId, progress, `استخراج... (${i + 1}/${chunks.length})`);
      
      const qs = await extractQuestionsFromChunk(chunks[i], i, chunks.length);
      allQuestions.push(...qs);
      
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log(`🎯 Total: ${allQuestions.length} questions`);
    return allQuestions;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

function validateQuestionsStrict(questions) {
  if (!Array.isArray(questions)) return [];

  let rejected = {
    noQuestion: 0,
    garbledQuestion: 0,
    noOptions: 0,
    garbledOptions: 0,
    noCorrect: 0,
    invalidCorrect: 0
  };

  const validated = questions.filter(q => {
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 5) {
      rejected.noQuestion++;
      return false;
    }
    
    if (!isReadableArabic(q.question)) {
      rejected.garbledQuestion++;
      console.log(`🚫 Garbled Q: "${q.question.substring(0, 50)}"`);
      return false;
    }
    
    if (!Array.isArray(q.options) || q.options.length < 2) {
      rejected.noOptions++;
      return false;
    }
    
    for (const opt of q.options) {
      if (!opt || typeof opt !== 'string' || opt.trim().length < 1) {
        rejected.garbledOptions++;
        return false;
      }
      if (!isReadableArabic(opt)) {
        rejected.garbledOptions++;
        console.log(`🚫 Garbled opt: "${opt}"`);
        return false;
      }
    }
    
    if (typeof q.correct !== 'number') {
      rejected.noCorrect++;
      return false;
    }
    
    if (q.correct < 0 || q.correct >= q.options.length) {
      rejected.invalidCorrect++;
      return false;
    }
    
    q.question = q.question.trim();
    q.options = q.options.map(o => String(o).trim());
    if (q.chapter) q.chapter = String(q.chapter).trim();
    
    return true;
  });

  const totalRejected = Object.values(rejected).reduce((a, b) => a + b, 0);
  if (totalRejected > 0) {
    console.log(`⚠️ Rejected ${totalRejected}:`, rejected);
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
    version: '2.2-FIXED'
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

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🚀 [${reqId}] ${req.file.originalname}`);
    console.log('='.repeat(50));

    updateProgress(reqId, 10, 'رفع...');
    await new Promise(r => setTimeout(r, 500));
    
    updateProgress(reqId, 25, 'استخراج...');
    const rawText = await extractTextFromPDF(req.file.buffer);
    
    if (!rawText || rawText.length < 100) {
      clearProgress(reqId);
      return res.status(400).json({ success: false, error: 'نص غير كافي' });
    }

    updateProgress(reqId, 40, 'تنظيف...');
    const cleaned = cleanText(rawText);

    updateProgress(reqId, 50, 'بدء...');
    const questions = await extractQuestionsWithAI(cleaned, reqId);

    if (!questions || questions.length === 0) {
      clearProgress(reqId);
      return res.status(400).json({ success: false, error: 'لا توجد أسئلة واضحة' });
    }

    updateProgress(reqId, 95, 'إنهاء...');
    
    const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))];
    const time = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log(`✅ ${questions.length} questions in ${time}s\n`);

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
  console.log('\n' + '='.repeat(50));
  console.log('🚀 AI Quiz System V2.2 FIXED');
  console.log('='.repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`✅ Syntax error FIXED`);
  console.log('='.repeat(50) + '\n');
});

module.exports = app;
