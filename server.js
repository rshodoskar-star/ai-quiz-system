// ====================================
// AI Quiz System - Backend Server V2.2 ULTIMATE
// FIXED: Arabic encoding + Better extraction
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

// Chunking Configuration
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
// ULTIMATE AI Prompt - Local Version (Original)
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
- بدون markdown (```json)
- بدون شرح
- استخرج فقط الأسئلة الواضحة والمقروءة

النص:`;

// ====================================
// ULTIMATE Arabic Text Fixing
// ====================================

/**
 * ULTIMATE fix for Arabic text encoding issues
 */
function fixArabicTextUltimate(text) {
  try {
    // Step 1: Normalize Unicode
    text = text.normalize('NFC');
    
    // Step 2: Fix common Windows-1256 / ISO-8859-6 encoding issues
    const encodingFixes = {
      'Ø£': 'أ', 'Ø¥': 'إ', 'Ø¢': 'آ', 'Ø¤': 'ؤ', 'Ø¦': 'ئ',
      'Ø§': 'ا', 'Ø¨': 'ب', 'Øª': 'ت', 'Ø«': 'ث', 'Ø¬': 'ج',
      'Ø­': 'ح', 'Ø®': 'خ', 'Ø¯': 'د', 'Ø°': 'ذ', 'Ø±': 'ر',
      'Ø²': 'ز', 'Ø³': 'س', 'Ø´': 'ش', 'Øµ': 'ص', 'Ø¶': 'ض',
      'Ø·': 'ط', 'Ø¸': 'ظ', 'Ø¹': 'ع', 'Øº': 'غ', 'Ù': 'ف',
      'Ù‚': 'ق', 'Ùƒ': 'ك', 'Ù„': 'ل', 'Ù…': 'م', 'Ù†': 'ن',
      'Ù‡': 'ه', 'Ùˆ': 'و', 'ÙŠ': 'ي', 'Ù‰': 'ى', 'Ø©': 'ة',
      'Ù': 'ف', 'Ù': 'ق', 'Ù': 'ل'
    };
    
    for (const [wrong, correct] of Object.entries(encodingFixes)) {
      text = text.replace(new RegExp(wrong, 'g'), correct);
    }
    
    // Step 3: Fix reversed text (RTL issues)
    // Detect if text is severely garbled
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    const totalChars = text.length;
    const arabicRatio = arabicChars / totalChars;
    
    // If less than 30% Arabic in supposed Arabic text, it's likely corrupted
    if (arabicRatio < 0.3 && totalChars > 50) {
      console.warn('⚠️ Text appears to be corrupted (low Arabic ratio:', arabicRatio, ')');
    }
    
    // Step 4: Remove zero-width and control characters
    text = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
    
    // Step 5: Fix common character substitutions
    text = text.replace(/[àáâãäå]/g, 'ا');
    text = text.replace(/[èéêë]/g, 'ه');
    text = text.replace(/[ìíîï]/g, 'ي');
    text = text.replace(/[òóôõö]/g, 'و');
    
    return text;
  } catch (error) {
    console.error('❌ Error fixing Arabic text:', error);
    return text;
  }
}

/**
 * Check if text is readable Arabic (not garbled)
 */
function isReadableArabic(text) {
  if (!text || text.length < 3) return false;
  
  // Count Arabic characters
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  
  if (totalChars === 0) return false;
  
  const arabicRatio = arabicChars / totalChars;
  
  // Should have at least 40% Arabic characters for Arabic text
  // Or should be pure English (for mixed content)
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const latinRatio = latinChars / totalChars;
  
  return arabicRatio > 0.4 || latinRatio > 0.6;
}

/**
 * Extract text from PDF with multiple encoding attempts
 */
async function extractTextFromPDF(buffer) {
  try {
    // Attempt 1: Standard extraction
    const data = await pdfParse(buffer, {
      max: 0,
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });
    
    let text = data.text;
    console.log(`📄 Extracted ${text.length} characters from PDF`);
    
    // Fix Arabic encoding
    text = fixArabicTextUltimate(text);
    
    // Check if text is readable
    const sample = text.substring(0, Math.min(500, text.length));
    if (!isReadableArabic(sample)) {
      console.warn('⚠️ Warning: Extracted text may have encoding issues');
      console.warn('Sample:', sample.substring(0, 100));
    }
    
    return text;
  } catch (error) {
    console.error('❌ PDF extraction error:', error);
    throw new Error('فشل استخراج النص من ملف PDF. تأكد من أن الملف غير محمي أو مشفر.');
  }
}

/**
 * Clean extracted text
 */
function cleanText(text) {
  // Remove headers/footers
  text = text.replace(/تصميم وتطوير ال[رب]مجيات.*?\d{10}/gi, '');
  text = text.replace(/أبو سليم للخدمات الطالبية.*?/gi, '');
  text = text.replace(/خربة? منذ \d{4}/gi, '');
  text = text.replace(/واتساب[\/:]?\s*\d{10}/gi, '');
  text = text.replace(/ال نحلل نرشه.*?/gi, '');
  
  // Remove page numbers
  text = text.replace(/صفحة\s*\d+/gi, '');
  text = text.replace(/\d+\s*\/\s*\d+/g, '');
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}

/**
 * Smart split into chunks
 */
function splitIntoChunks(text, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  const questionPattern = /(?=\n\s*(?:\d+[\.\):]|\([أابتث]\)|س\s*\d+|سؤال\s*\d+))/g;
  const questionBlocks = text.split(questionPattern).filter(block => block.trim());
  
  if (questionBlocks.length <= 1) {
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph).length <= chunkSize) {
        currentChunk += paragraph + '\n\n';
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        
        if (paragraph.length > chunkSize) {
          const words = paragraph.split(/\s+/);
          let tempChunk = '';
          for (const word of words) {
            if ((tempChunk + word).length <= chunkSize) {
              tempChunk += word + ' ';
            } else {
              if (tempChunk) chunks.push(tempChunk.trim());
              tempChunk = word + ' ';
            }
          }
          if (tempChunk) currentChunk = tempChunk;
          else currentChunk = '';
        } else {
          currentChunk = paragraph + '\n\n';
        }
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
  
  console.log(`📦 Split into ${chunks.length} chunks (avg ${Math.round(text.length / chunks.length)} chars)`);
  return chunks;
}

/**
 * Extract questions from chunk with strict validation
 */
async function extractQuestionsFromChunk(text, chunkIndex, totalChunks) {
  let questions = [];
  try {
    console.log(`🔄 Processing chunk ${chunkIndex + 1}/${totalChunks} (${text.length} chars)`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في استخراج أسئلة الامتحانات. استخرج فقط الأسئلة الواضحة والمقروءة. تجاهل أي نص متلخبط أو غير مفهوم.'
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
      let cleanedResponse = response.trim();
      cleanedResponse = cleanedResponse.replace(/^```json\s*/i, '');
      cleanedResponse = cleanedResponse.replace(/^```\s*/i, '');
      cleanedResponse = cleanedResponse.replace(/\s*```$/i, '');
      cleanedResponse = cleanedResponse.trim();
      
      const parsed = JSON.parse(cleanedResponse);
      questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (parseError) {
      console.error('⚠️ JSON parse error:', parseError.message);
      
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        questions = [];
      }
    }

    const validated = validateQuestionsStrict(questions);
    console.log(`✅ Chunk ${chunkIndex + 1}/${totalChunks}: Extracted ${validated.length} valid questions (rejected ${questions.length - validated.length})`);
    
    return validated;
    
  } catch (error) {
    console.error(`❌ Error chunk ${chunkIndex + 1}:`, error.message);
    return [];
  }
}

/**
 * Extract questions with chunking
 */
async function extractQuestionsWithAI(text, requestId) {
  try {
    const textLength = text.length;
    console.log(`📝 Total text: ${textLength} chars`);
    
    if (textLength <= CHUNK_SIZE) {
      updateProgress(requestId, 70, 'استخراج الأسئلة...');
      return await extractQuestionsFromChunk(text, 0, 1);
    }
    
    updateProgress(requestId, 55, 'تقسيم النص...');
    const chunks = splitIntoChunks(text, CHUNK_SIZE);
    
    const allQuestions = [];
    const progressPerChunk = 35 / chunks.length;
    
    for (let i = 0; i < chunks.length; i++) {
      const progress = 55 + Math.round((i + 1) * progressPerChunk);
      updateProgress(requestId, progress, `استخراج... (${i + 1}/${chunks.length})`);
      
      const questions = await extractQuestionsFromChunk(chunks[i], i, chunks.length);
      allQuestions.push(...questions);
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`🎯 Total extracted: ${allQuestions.length} questions from ${chunks.length} chunks`);
    return allQuestions;
    
  } catch (error) {
    console.error('❌ Error in extraction:', error);
    throw error;
  }
}

/**
 * STRICT validation - Reject garbled text
 */
function validateQuestionsStrict(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }

  let rejected = {
    noQuestion: 0,
    garbledQuestion: 0,
    noOptions: 0,
    fewOptions: 0,
    garbledOptions: 0,
    noCorrect: 0,
    invalidCorrect: 0
  };

  const validated = questions.filter(q => {
    // Check question exists
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 5) {
      rejected.noQuestion++;
      return false;
    }
    
    // Check if question is readable
    if (!isReadableArabic(q.question)) {
      rejected.garbledQuestion++;
      console.log(`🚫 Rejected garbled question: "${q.question.substring(0, 50)}..."`);
      return false;
    }
    
    // Check options
    if (!Array.isArray(q.options) || q.options.length < 2) {
      rejected.noOptions++;
      return false;
    }
    
    // Check each option is readable
    for (const option of q.options) {
      if (!option || typeof option !== 'string' || option.trim().length < 1) {
        rejected.garbledOptions++;
        return false;
      }
      
      if (!isReadableArabic(option)) {
        rejected.garbledOptions++;
        console.log(`🚫 Rejected garbled option: "${option}"`);
        return false;
      }
    }
    
    // Check correct answer
    if (typeof q.correct !== 'number') {
      rejected.noCorrect++;
      return false;
    }
    
    if (q.correct < 0 || q.correct >= q.options.length) {
      rejected.invalidCorrect++;
      return false;
    }
    
    // Clean fields
    q.question = q.question.trim();
    q.options = q.options.map(opt => String(opt).trim());
    if (q.chapter) q.chapter = String(q.chapter).trim();
    
    return true;
  });

  const totalRejected = Object.values(rejected).reduce((a, b) => a + b, 0);
  if (totalRejected > 0) {
    console.log(`⚠️ Validation: Rejected ${totalRejected} questions`);
    console.log('Reasons:', rejected);
  }

  return validated;
}

// ====================================
// API Routes
// ====================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    model: OPENAI_MODEL,
    version: '2.2-ULTIMATE'
  });
});

app.get('/api/progress/:requestId', (req, res) => {
  const { requestId } = req.params;
  const progress = getProgress(requestId);
  res.json(progress);
});

app.post('/api/quiz-from-pdf', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم رفع أي ملف'
      });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 [${requestId}] Processing: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log('='.repeat(60));

    updateProgress(requestId, 10, 'رفع الملف...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    updateProgress(requestId, 25, 'استخراج النص...');
    const rawText = await extractTextFromPDF(req.file.buffer);
    
    if (!rawText || rawText.length < 100) {
      clearProgress(requestId);
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ'
      });
    }

    updateProgress(requestId, 40, 'تنظيف النص...');
    const cleanedText = cleanText(rawText);
    console.log(`✨ Cleaned: ${cleanedText.length} chars`);

    updateProgress(requestId, 50, 'بدء الاستخراج...');
    const questions = await extractQuestionsWithAI(cleanedText, requestId);

    if (!questions || questions.length === 0) {
      clearProgress(requestId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة واضحة. تأكد من أن الملف يحتوي على أسئلة بصيغة صحيحة.'
      });
    }

    updateProgress(requestId, 95, 'جاري الإنهاء...');
    
    const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))];
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ SUCCESS! Extracted ${questions.length} questions in ${processingTime}s`);
    console.log('='.repeat(60) + '\n');

    updateProgress(requestId, 100, 'تم بنجاح! ✅');
    setTimeout(() => clearProgress(requestId), 5000);

    res.json({
      success: true,
      requestId: requestId,
      totalQuestions: questions.length,
      chapters: chapters,
      questions: questions,
      processingTime: `${processingTime}s`
    });

  } catch (error) {
    console.error(`❌ [${requestId}] Error:`, error);
    clearProgress(requestId);
    
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
  res.status(500).json({
    success: false,
    error: err.message || 'حدث خطأ في الخادم'
  });
});

// ====================================
// Start Server
// ====================================

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AI Quiz System Server V2.2 ULTIMATE');
  console.log('='.repeat(60));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`📁 Max PDF: ${MAX_PDF_SIZE_MB}MB`);
  console.log(`📦 Chunk: ${CHUNK_SIZE} chars`);
  console.log(`🔒 Rate: ${process.env.RATE_LIMIT_MAX_REQUESTS || 10} req/hour`);
  console.log('✨ Features:');
  console.log('   - ULTIMATE Arabic Encoding Fix');
  console.log('   - Strict Garbled Text Detection');
  console.log('   - Original Local Prompt');
  console.log('   - Smart Chunking');
  console.log('   - Progress Tracking');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
