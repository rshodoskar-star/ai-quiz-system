// ====================================
// AI Quiz System - Backend Server V2
// Enhanced Version with Chunking & Progress Tracking
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
const CHUNK_SIZE = 4000; // characters per chunk
const MAX_TOKENS_PER_REQUEST = 3500;

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

// Clean old progress entries (older than 10 minutes)
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

// Configure multer
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
// Enhanced AI Prompt Template
// ====================================

const AI_PROMPT = `أنت أداة متخصصة في تحويل نصوص الامتحانات العربية إلى أسئلة اختيار من متعدد منظمة.

المدخلات:
- نص عربي مستخرج من ملف PDF يحتوي على أسئلة امتحان.

مهمتك:
1. استخراج أسئلة الاختيار من متعدد فقط (MCQ).
2. لكل سؤال، استخرج:
   - chapter (نص، اختياري): اسم الفصل إن وجد
   - question (نص، إلزامي): نص السؤال كاملاً
   - options (مصفوفة): 2-10 خيارات للإجابة
   - correct (رقم، إلزامي): رقم الخيار الصحيح (يبدأ من 0)

CRITICAL RULES:
1. استخرج فقط الأسئلة الواضحة والمكتملة
2. إذا السؤال غير واضح - احذفه
3. إذا الخيارات غير واضحة - احذف السؤال
4. تأكد أن كل سؤال له خيارين على الأقل
5. تأكد أن رقم الإجابة الصحيحة بين 0 و (عدد الخيارات - 1)
6. احذف أي سؤال غير مكتمل أو غامض

المخرجات - JSON ONLY:
يجب أن تطابق JSON هذا الشكل بالضبط:

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

IMPORTANT:
- Return ONLY valid JSON array
- No markdown (\`\`\`json)
- No explanations
- No comments
- Pure JSON only

الآن، استخرج الأسئلة من النص التالي:`;

// ====================================
// Helper Functions
// ====================================

/**
 * Fix Arabic text encoding issues
 */
function fixArabicText(text) {
  try {
    // Normalize Unicode
    text = text.normalize('NFC');
    
    // Fix common Arabic encoding issues
    text = text.replace(/Ø£/g, 'أ');
    text = text.replace(/Ø¥/g, 'إ');
    text = text.replace(/Ø¢/g, 'آ');
    text = text.replace(/Ø¤/g, 'ؤ');
    text = text.replace(/Ø¦/g, 'ئ');
    
    // Remove zero-width characters
    text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
    
    return text;
  } catch (error) {
    console.error('Error fixing Arabic text:', error);
    return text;
  }
}

/**
 * Extract text from PDF with better encoding support
 */
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer, {
      max: 0, // all pages
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });
    
    let text = data.text;
    
    // Fix Arabic encoding
    text = fixArabicText(text);
    
    return text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('فشل استخراج النص من ملف PDF. تأكد من أن الملف غير محمي أو مشفر.');
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
 * Split text into chunks for processing
 */
function splitIntoChunks(text, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length <= chunkSize) {
      currentChunk += paragraph + '\n\n';
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph + '\n\n';
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * Call OpenAI to extract questions from a text chunk
 */
async function extractQuestionsFromChunk(text, chunkIndex, totalChunks) {
  try {
    console.log(`Processing chunk ${chunkIndex + 1}/${totalChunks} (${text.length} chars)`);
    
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في استخراج وتنظيم أسئلة الامتحانات من النصوص العربية. يجب أن يكون الرد بصيغة JSON صالحة فقط بدون أي نص إضافي.'
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
    
    // Parse JSON with better error handling
    let questions;
    try {
      let cleanedResponse = response.trim();
      cleanedResponse = cleanedResponse.replace(/^```json\s*/i, '');
      cleanedResponse = cleanedResponse.replace(/^```\s*/i, '');
      cleanedResponse = cleanedResponse.replace(/\s*```$/i, '');
      cleanedResponse = cleanedResponse.trim();
      
      const parsed = JSON.parse(cleanedResponse);
      questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (parseError) {
      console.error('JSON parse error for chunk:', parseError);
      
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        console.error('No valid JSON found in chunk response');
        return [];
      }
    }

    return validateQuestions(questions);
    
  } catch (error) {
    console.error(`Error processing chunk ${chunkIndex + 1}:`, error);
    return [];
  }
}

/**
 * Extract questions with chunking support
 */
async function extractQuestionsWithAI(text, requestId) {
  try {
    const textLength = text.length;
    console.log(`Total text length: ${textLength} characters`);
    
    // If text is small, process directly
    if (textLength <= CHUNK_SIZE) {
      updateProgress(requestId, 70, 'استخراج الأسئلة بالذكاء الاصطناعي...');
      const questions = await extractQuestionsFromChunk(text, 0, 1);
      return questions;
    }
    
    // Split into chunks
    updateProgress(requestId, 55, 'تقسيم النص إلى أجزاء...');
    const chunks = splitIntoChunks(text, CHUNK_SIZE);
    console.log(`Split into ${chunks.length} chunks`);
    
    // Process each chunk
    const allQuestions = [];
    const progressPerChunk = 35 / chunks.length; // 55% to 90%
    
    for (let i = 0; i < chunks.length; i++) {
      const progress = 55 + Math.round((i + 1) * progressPerChunk);
      updateProgress(requestId, progress, `استخراج الأسئلة... (${i + 1}/${chunks.length})`);
      
      const questions = await extractQuestionsFromChunk(chunks[i], i, chunks.length);
      allQuestions.push(...questions);
      
      // Small delay to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`Extracted ${allQuestions.length} questions from ${chunks.length} chunks`);
    return allQuestions;
    
  } catch (error) {
    console.error('Error in extractQuestionsWithAI:', error);
    throw error;
  }
}

/**
 * Validate questions array
 */
function validateQuestions(questions) {
  if (!Array.isArray(questions)) {
    console.error('Questions is not an array:', typeof questions);
    return [];
  }

  return questions.filter(q => {
    // Check required fields
    if (!q.question || typeof q.question !== 'string') {
      return false;
    }
    if (!Array.isArray(q.options)) {
      return false;
    }
    if (q.options.length < 2) {
      return false;
    }
    if (typeof q.correct !== 'number') {
      return false;
    }
    if (q.correct < 0 || q.correct >= q.options.length) {
      return false;
    }
    
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
    model: OPENAI_MODEL,
    version: '2.0'
  });
});

/**
 * Progress check endpoint
 */
app.get('/api/progress/:requestId', (req, res) => {
  const { requestId } = req.params;
  const progress = getProgress(requestId);
  res.json(progress);
});

/**
 * Main endpoint: Convert PDF to quiz questions
 */
app.post('/api/quiz-from-pdf', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Validate file exists
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم رفع أي ملف'
      });
    }

    console.log(`[${requestId}] Processing PDF: ${req.file.originalname} (${req.file.size} bytes)`);

    // Step 1: Extract text from PDF
    updateProgress(requestId, 10, 'رفع الملف...');
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate upload
    
    updateProgress(requestId, 25, 'استخراج النص من PDF...');
    const rawText = await extractTextFromPDF(req.file.buffer);
    
    if (!rawText || rawText.length < 100) {
      clearProgress(requestId);
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ أو قد يكون محمياً'
      });
    }

    // Step 2: Clean text
    updateProgress(requestId, 40, 'تنظيف النص...');
    const cleanedText = cleanText(rawText);
    console.log(`[${requestId}] Text cleaned: ${cleanedText.length} characters`);

    // Step 3: Extract questions using AI (with chunking)
    updateProgress(requestId, 50, 'بدء استخراج الأسئلة...');
    const questions = await extractQuestionsWithAI(cleanedText, requestId);

    if (!questions || questions.length === 0) {
      clearProgress(requestId);
      return res.status(400).json({
        success: false,
        error: 'لم يتم العثور على أسئلة واضحة في الملف. تأكد من أن الملف يحتوي على أسئلة اختيار من متعدد بصيغة واضحة.'
      });
    }

    // Finalize
    updateProgress(requestId, 95, 'جاري الإنهاء...');
    
    // Get chapters list
    const chapters = [...new Set(questions.map(q => q.chapter).filter(Boolean))];

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[${requestId}] Success! Extracted ${questions.length} questions in ${processingTime}s`);

    updateProgress(requestId, 100, 'تم بنجاح! ✅');
    
    // Clear progress after 5 seconds
    setTimeout(() => clearProgress(requestId), 5000);

    // Return success response
    res.json({
      success: true,
      requestId: requestId,
      totalQuestions: questions.length,
      chapters: chapters,
      questions: questions,
      processingTime: `${processingTime}s`
    });

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    clearProgress(requestId);
    
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
  console.log('🚀 AI Quiz System Server V2.0');
  console.log('====================================');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🤖 AI Model: ${OPENAI_MODEL}`);
  console.log(`📁 Max PDF size: ${MAX_PDF_SIZE_MB}MB`);
  console.log(`📦 Chunk size: ${CHUNK_SIZE} chars`);
  console.log(`🔒 Rate limit: ${process.env.RATE_LIMIT_MAX_REQUESTS || 10} requests/hour`);
  console.log('✨ Features: Chunking, Progress Tracking, Enhanced PDF Parsing');
  console.log('====================================');
});

module.exports = app;
