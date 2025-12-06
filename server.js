// ====================================
// AI Quiz System V5.0 GEMINI VISION
// Uses Gemini 2.0 Flash to read PDF directly!
// $0.05 per file - 10x cheaper!
// ====================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { fromPath } = require('pdf2pic');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize AI clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GEMINI_MODEL = 'gemini-2.0-flash-exp';
const MAX_PDF_SIZE_MB = parseInt(process.env.MAX_PDF_SIZE_MB) || 50;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

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
// PDF to Images Conversion
// ====================================

async function convertPDFToImages(pdfBuffer, reqId) {
  try {
    // Create temp directory
    const tempDir = path.join('/tmp', `pdf_${reqId}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Save PDF temporarily
    const tempPdfPath = path.join(tempDir, 'input.pdf');
    await fs.writeFile(tempPdfPath, pdfBuffer);
    
    console.log(`📄 Converting PDF to images...`);
    
    // Convert PDF to images
    const converter = fromPath(tempPdfPath, {
      density: 200,
      saveFilename: 'page',
      savePath: tempDir,
      format: 'png',
      width: 2000,
      height: 2000
    });
    
    // Get PDF page count
    const pdfData = await pdfParse(pdfBuffer);
    const pageCount = pdfData.numpages;
    
    console.log(`📊 PDF has ${pageCount} pages`);
    
    // Convert all pages
    const imagePromises = [];
    for (let i = 1; i <= Math.min(pageCount, 50); i++) { // Limit to 50 pages
      imagePromises.push(converter(i));
    }
    
    const results = await Promise.all(imagePromises);
    
    // Read image files
    const images = [];
    for (let i = 0; i < results.length; i++) {
      const imagePath = results[i].path;
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      images.push({
        data: base64Image,
        mimeType: 'image/png'
      });
      console.log(`✅ Converted page ${i + 1}/${results.length}`);
    }
    
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
    
    return images;
    
  } catch (error) {
    console.error('PDF conversion error:', error);
    throw new Error('فشل تحويل PDF إلى صور');
  }
}

// ====================================
// Gemini Vision Extraction
// ====================================

const GEMINI_PROMPT = `استخرج جميع أسئلة الاختيار من متعدد من هذه الصور.

القواعد:
1. اقرأ النص بالضبط كما هو مكتوب
2. استخرج كل سؤال تجده
3. صحح أي أخطاء إملائية بسيطة

أخرج JSON object فقط:
{
  "questions": [
    {
      "chapter": "اسم الفصل",
      "question": "نص السؤال",
      "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
      "correct": 0
    }
  ]
}

مهم: أخرج JSON فقط، بدون markdown، بدون نص إضافي.`;

async function extractWithGemini(images, reqId) {
  try {
    console.log(`🤖 Calling Gemini 2.0 Flash for ${images.length} pages...`);
    updateProgress(reqId, 50, `معالجة ${images.length} صفحة بـ Gemini...`);
    
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });
    
    // Prepare content parts
    const parts = [
      { text: GEMINI_PROMPT }
    ];
    
    // Add all images
    for (const image of images) {
      parts.push({
        inlineData: {
          data: image.data,
          mimeType: image.mimeType
        }
      });
    }
    
    // Generate content
    const result = await model.generateContent(parts);
    const response = await result.response;
    const text = response.text();
    
    console.log(`📥 Gemini response length: ${text.length}`);
    
    // Parse JSON
    let questions = [];
    try {
      const parsed = JSON.parse(text);
      questions = parsed.questions || parsed.Questions || [];
      
      if (!Array.isArray(questions)) {
        console.warn('⚠️ Questions is not an array');
        questions = [];
      }
    } catch (e) {
      console.error('❌ JSON parse error:', e.message);
      // Try to extract JSON from text
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          questions = parsed.questions || [];
        } catch (e2) {
          console.error('❌ Second parse attempt failed');
        }
      }
    }
    
    const validated = validateQuestions(questions);
    console.log(`✅ Gemini extracted: ${validated.length} questions`);
    
    return validated;
    
  } catch (error) {
    console.error('❌ Gemini error:', error.message);
    throw error;
  }
}

// ====================================
// Fallback: OpenAI extraction (if Gemini fails)
// ====================================

async function extractWithOpenAIFallback(pdfBuffer, reqId) {
  try {
    console.log('⚠️ Using OpenAI fallback...');
    updateProgress(reqId, 50, 'استخدام النظام الاحتياطي...');
    
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;
    
    if (!text || text.length < 100) {
      throw new Error('لا يوجد نص كافٍ في الملف');
    }
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: "json_object" },
      messages: [
        {
          role: 'system',
          content: 'استخرج الأسئلة وأخرج JSON object مع key "questions".'
        },
        {
          role: 'user',
          content: `استخرج جميع أسئلة الاختيار من متعدد:\n\n${text.substring(0, 50000)}`
        }
      ],
      temperature: 0.2,
      max_tokens: 16000
    });
    
    const response = completion.choices[0].message.content;
    const parsed = JSON.parse(response);
    const questions = parsed.questions || [];
    
    return validateQuestions(questions);
    
  } catch (error) {
    console.error('❌ OpenAI fallback error:', error);
    throw error;
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
    model: GEMINI_MODEL,
    version: '5.0-GEMINI-VISION',
    geminiAvailable: !!process.env.GEMINI_API_KEY,
    openaiBackup: !!process.env.OPENAI_API_KEY
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
    console.log(`🚀 V5.0 GEMINI VISION [${reqId}]`);
    console.log(`📄 ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع الملف...');
    
    let questions = [];
    
    // Try Gemini Vision first
    if (process.env.GEMINI_API_KEY) {
      try {
        updateProgress(reqId, 20, 'تحويل PDF إلى صور...');
        const images = await convertPDFToImages(req.file.buffer, reqId);
        
        updateProgress(reqId, 40, `معالجة ${images.length} صفحة...`);
        questions = await extractWithGemini(images, reqId);
        
      } catch (geminiError) {
        console.error('⚠️ Gemini failed:', geminiError.message);
        
        // Fallback to OpenAI if available
        if (process.env.OPENAI_API_KEY) {
          console.log('🔄 Falling back to OpenAI...');
          questions = await extractWithOpenAIFallback(req.file.buffer, reqId);
        } else {
          throw geminiError;
        }
      }
    } else {
      // No Gemini key, use OpenAI directly
      questions = await extractWithOpenAIFallback(req.file.buffer, reqId);
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
      model: process.env.GEMINI_API_KEY ? 'gemini-vision' : 'openai-fallback'
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
  console.log('🚀 AI Quiz System V5.0 GEMINI VISION');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Primary: ${GEMINI_MODEL}`);
  console.log(`🔄 Backup: ${process.env.OPENAI_API_KEY ? 'OpenAI GPT-4' : 'None'}`);
  console.log('⭐ Features:');
  console.log('   - Reads PDF as images (no text extraction!)');
  console.log('   - Gemini 2.0 Flash Vision');
  console.log('   - 10x cheaper than GPT-4 Vision');
  console.log('   - OpenAI fallback if Gemini fails');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
