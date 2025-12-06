// ====================================
// AI Quiz System V4.0 VISION
// Uses GPT-4 Vision to READ PDF images directly
// Solves: encoding issues + garbled text + missing questions
// ====================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const VISION_MODEL = 'gpt-4o'; // Vision support
const MAX_PDF_SIZE_MB = parseInt(process.env.MAX_PDF_SIZE_MB) || 50;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;
const USE_VISION = process.env.USE_VISION === 'true' || true; // Enable by default

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
// VISION Prompt
// ====================================

const VISION_PROMPT = `أنت خبير في قراءة وتحليل أسئلة الامتحانات من الصور.

المهمة: اقرأ الصورة واستخرج جميع أسئلة الاختيار من متعدد (MCQ).

القواعد:
1. اقرأ كل سؤال بدقة كما هو مكتوب في الصورة
2. لكل سؤال:
   - question: نص السؤال بالضبط
   - options: جميع الخيارات (2-6)
   - correct: رقم الخيار الصحيح (من 0)
   - chapter: اسم الفصل إن وجد

3. استخرج كل الأسئلة - لا تترك شيئاً
4. احرص على الدقة في الحروف العربية

الصيغة - JSON فقط:
[
  {
    "chapter": "الفصل الأول",
    "question": "ما هو تعريف البرمجيات؟",
    "options": ["التعليمات والبرامج", "الأجهزة", "الشبكات", "قواعد البيانات"],
    "correct": 0
  }
]

مهم جداً:
- JSON فقط بدون markdown
- استخرج كل الأسئلة الموجودة في الصورة
- احرص على دقة النص العربي`;

// ====================================
// PDF to Images (using pdf-poppler or pdftoppm)
// ====================================

async function convertPDFToImages(pdfBuffer, requestId) {
  try {
    // Create temp directory
    const tempDir = `/tmp/pdf_${Date.now()}`;
    await fs.mkdir(tempDir, { recursive: true });
    
    // Save PDF to temp file
    const pdfPath = `${tempDir}/input.pdf`;
    await fs.writeFile(pdfPath, pdfBuffer);
    
    console.log(`📄 Converting PDF to images...`);
    
    // Try pdftoppm (usually available in Linux)
    try {
      const outputPrefix = `${tempDir}/page`;
      await execAsync(`pdftoppm -png -r 150 "${pdfPath}" "${outputPrefix}"`);
      
      // Get all generated images
      const files = await fs.readdir(tempDir);
      const imageFiles = files
        .filter(f => f.startsWith('page') && f.endsWith('.png'))
        .sort();
      
      console.log(`✅ Converted to ${imageFiles.length} images`);
      
      // Read images as base64
      const images = [];
      for (const file of imageFiles) {
        const imgPath = `${tempDir}/${file}`;
        const imgBuffer = await fs.readFile(imgPath);
        const base64 = imgBuffer.toString('base64');
        images.push(base64);
      }
      
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
      
      return images;
      
    } catch (pdfError) {
      console.warn('pdftoppm not available, falling back to text extraction');
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }
    
  } catch (error) {
    console.error('Error converting PDF:', error);
    return null;
  }
}

// ====================================
// Extract questions using Vision
// ====================================

async function extractQuestionsFromImage(base64Image, pageNum, totalPages) {
  try {
    console.log(`👁️ Reading page ${pageNum}/${totalPages} with Vision...`);
    
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'system',
          content: 'أنت خبير في قراءة أسئلة الامتحانات من الصور بدقة عالية.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: VISION_PROMPT
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 4096,
      temperature: 0.2
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
          console.error('Failed to parse JSON from Vision response');
        }
      }
    }

    const validated = validateQuestions(questions);
    console.log(`✅ Page ${pageNum}: ${validated.length} questions extracted`);
    
    return validated;
    
  } catch (error) {
    console.error(`❌ Error reading page ${pageNum}:`, error.message);
    return [];
  }
}

async function extractQuestionsWithVision(pdfBuffer, requestId) {
  try {
    updateProgress(requestId, 25, 'تحويل PDF إلى صور...');
    
    const images = await convertPDFToImages(pdfBuffer, requestId);
    
    if (!images || images.length === 0) {
      console.log('⚠️ Vision not available, falling back to text mode');
      return null; // Will fallback to text extraction
    }
    
    console.log(`📸 Processing ${images.length} pages with Vision...`);
    
    const allQuestions = [];
    const progressPerPage = 60 / images.length;
    
    for (let i = 0; i < images.length; i++) {
      const progress = 30 + Math.round((i + 1) * progressPerPage);
      updateProgress(requestId, progress, `قراءة الصفحة ${i + 1}/${images.length}...`);
      
      const questions = await extractQuestionsFromImage(images[i], i + 1, images.length);
      allQuestions.push(...questions);
      
      // Small delay to avoid rate limits
      if (i < images.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    console.log(`🎯 Vision extraction: ${allQuestions.length} questions from ${images.length} pages`);
    return allQuestions;
    
  } catch (error) {
    console.error('Vision extraction failed:', error);
    return null;
  }
}

// ====================================
// Fallback: Text extraction
// ====================================

async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error('فشل استخراج النص');
  }
}

function cleanText(text) {
  text = text.replace(/تصميم وتطوير.*?\d{10}/gi, '');
  text = text.replace(/أبو سليم.*?/gi, '');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

async function extractQuestionsFromText(text, requestId) {
  // Simplified text extraction (fallback)
  updateProgress(requestId, 50, 'استخراج من النص...');
  
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'system',
        content: 'استخرج أسئلة الاختيار من متعدد من النص.'
      },
      {
        role: 'user',
        content: `استخرج كل أسئلة MCQ من هذا النص وحولها لـ JSON:\n\n${text.substring(0, 15000)}`
      }
    ],
    temperature: 0.3,
    max_tokens: 4096
  });

  const response = completion.choices[0].message.content;
  
  try {
    let clean = response.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    
    const parsed = JSON.parse(clean);
    const questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    return validateQuestions(questions);
  } catch (e) {
    return [];
  }
}

// ====================================
// Validation
// ====================================

function validateQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions.filter(q => {
    if (!q.question || typeof q.question !== 'string' || q.question.length < 10) {
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
    vision: USE_VISION,
    version: '4.0-VISION'
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
    console.log(`🚀 [${reqId}] ${req.file.originalname}`);
    console.log(`📊 Mode: ${USE_VISION ? 'VISION 👁️' : 'TEXT'}`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع الملف...');
    
    let questions = [];
    
    // Try Vision first (if enabled)
    if (USE_VISION) {
      questions = await extractQuestionsWithVision(req.file.buffer, reqId);
    }
    
    // Fallback to text if Vision failed or not available
    if (!questions || questions.length === 0) {
      console.log('⚠️ Using text extraction fallback...');
      updateProgress(reqId, 30, 'استخراج النص...');
      const text = await extractTextFromPDF(req.file.buffer);
      const cleaned = cleanText(text);
      questions = await extractQuestionsFromText(cleaned, reqId);
    }

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
      processingTime: `${time}s`,
      method: USE_VISION ? 'vision' : 'text'
    });

  } catch (error) {
    console.error(`❌ [${reqId}]:`, error);
    clearProgress(reqId);
    
    res.status(500).json({
      success: false,
      error: error.message || 'خطأ في المعالجة'
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
  console.log('🚀 AI Quiz System V4.0 VISION');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`👁️ Vision: ${USE_VISION ? 'ENABLED ✅' : 'DISABLED'}`);
  console.log('✨ Features:');
  console.log('   - GPT-4 Vision reads PDF as images');
  console.log('   - Solves encoding issues');
  console.log('   - Solves garbled text');
  console.log('   - Extracts ALL questions accurately');
  console.log('   - Fallback to text if needed');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
