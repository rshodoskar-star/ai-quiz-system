// ====================================
// AI Quiz System V6.0 CLAUDE TEXT
// Claude 3.5 Sonnet - The Arabic Master!
// Smart text understanding - $0.08-0.10 per file
// ====================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize AI clients
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CLAUDE_MODEL = 'claude-3-5-sonnet-20240620'; // Public version
const CHUNK_SIZE = 30000; // Optimal for Claude
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
    /(?=(?:\n|^)\s*\(\d+\))/g,
    /(?=(?:\n|^)\s*س(?:ؤال)?\s*\d+)/g
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
// Claude 3.5 Sonnet Extraction
// ====================================

const CLAUDE_PROMPT = `أنت خبير في استخراج أسئلة الاختيار من متعدد من النصوص العربية.

مهمتك:
1. اقرأ النص بعناية (قد يحتوي على أخطاء من استخراج PDF)
2. استخرج كل أسئلة الاختيار من متعدد
3. صحح أي أخطاء إملائية أو تلخبط في النص
4. رتب الأسئلة بشكل صحيح

مثال للتصحيح:
"همزحت البرمجياث" → "هندسة البرمجيات"
"معمليات" → "عمليات"
"يحن" → "بين"

أخرج JSON object بهذا الشكل بالضبط:
{
  "questions": [
    {
      "chapter": "اسم الفصل (إن وجد)",
      "question": "نص السؤال",
      "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
      "correct": 0
    }
  ]
}

مهم جداً:
- أخرج JSON فقط
- لا تضف أي نص قبل أو بعد JSON
- استخرج كل الأسئلة التي تجدها
- صحح الأخطاء تلقائياً`;

async function extractWithClaude(chunk, index, total, reqId) {
  try {
    console.log(`🤖 [Claude] Processing chunk ${index + 1}/${total}`);
    
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      temperature: 0.2,
      system: CLAUDE_PROMPT,
      messages: [
        {
          role: 'user',
          content: `استخرج أسئلة الاختيار من متعدد من هذا النص:\n\n${chunk}`
        }
      ]
    });
    
    const response = message.content[0].text;
    console.log(`📥 Claude response length: ${response.length}`);
    
    // Parse JSON
    let questions = [];
    try {
      // Clean response
      let cleaned = response.trim();
      
      // Remove markdown if present
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
      }
      
      // Find JSON object
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        questions = parsed.questions || parsed.Questions || [];
      } else {
        throw new Error('No JSON found');
      }
      
      if (!Array.isArray(questions)) {
        console.warn('⚠️ Questions is not an array');
        questions = [];
      }
      
    } catch (e) {
      console.error(`❌ JSON parse error:`, e.message);
      console.log('Response preview:', response.substring(0, 200));
    }
    
    const validated = validateQuestions(questions);
    console.log(`✅ [Claude] Chunk ${index + 1}: ${validated.length} questions`);
    
    return validated;
    
  } catch (error) {
    console.error(`❌ [Claude] Chunk ${index + 1}:`, error.message);
    return [];
  }
}

async function extractAllWithClaude(text, reqId) {
  try {
    const chunks = smartSplit(text, CHUNK_SIZE);
    updateProgress(reqId, 40, `معالجة ${chunks.length} أجزاء بـ Claude...`);
    
    const PARALLEL_LIMIT = 3;
    const allQuestions = [];
    
    for (let i = 0; i < chunks.length; i += PARALLEL_LIMIT) {
      const batch = chunks.slice(i, i + PARALLEL_LIMIT);
      const progress = 40 + Math.round((i / chunks.length) * 50);
      updateProgress(reqId, progress, `معالجة... (${i + 1}/${chunks.length})`);
      
      const promises = batch.map((chunk, idx) => 
        extractWithClaude(chunk, i + idx, chunks.length, reqId)
      );
      
      const results = await Promise.all(promises);
      allQuestions.push(...results.flat());
      
      if (i + PARALLEL_LIMIT < chunks.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    console.log(`✅ [Claude] Total extracted: ${allQuestions.length} questions`);
    return allQuestions;
    
  } catch (error) {
    console.error('Claude extraction error:', error);
    throw error;
  }
}

// ====================================
// Fallback: OpenAI/Gemini
// ====================================

async function extractWithFallback(text, reqId) {
  try {
    console.log('⚠️ Using fallback extraction...');
    updateProgress(reqId, 50, 'استخدام النظام الاحتياطي...');
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: "json_object" },
      messages: [
        {
          role: 'system',
          content: 'استخرج أسئلة الاختيار من متعدد. أخرج JSON object مع key "questions".'
        },
        {
          role: 'user',
          content: `استخرج الأسئلة:\n\n${text.substring(0, 50000)}`
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
    console.error('❌ Fallback error:', error);
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
    model: CLAUDE_MODEL,
    version: '6.0-CLAUDE-TEXT',
    claudeAvailable: !!process.env.CLAUDE_API_KEY,
    fallbackAvailable: !!process.env.OPENAI_API_KEY
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
    console.log(`🚀 V6.0 CLAUDE TEXT [${reqId}]`);
    console.log(`📄 ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`);
    console.log('='.repeat(60));

    updateProgress(reqId, 10, 'رفع الملف...');
    await new Promise(r => setTimeout(r, 300));
    
    updateProgress(reqId, 25, 'استخراج النص من PDF...');
    const text = await extractTextFromPDF(req.file.buffer);
    
    if (!text || text.length < 100) {
      clearProgress(reqId);
      return res.status(400).json({
        success: false,
        error: 'الملف لا يحتوي على نص كافٍ'
      });
    }

    console.log(`📝 Extracted ${text.length} characters`);

    let questions = [];
    let modelUsed = 'claude';
    
    // Try Claude first
    if (process.env.CLAUDE_API_KEY) {
      try {
        questions = await extractAllWithClaude(text, reqId);
      } catch (claudeError) {
        console.error('⚠️ Claude failed:', claudeError.message);
        
        // Fallback to OpenAI if available
        if (process.env.OPENAI_API_KEY) {
          console.log('🔄 Falling back to OpenAI...');
          questions = await extractWithFallback(text, reqId);
          modelUsed = 'openai-fallback';
        } else {
          throw claudeError;
        }
      }
    } else {
      // No Claude key, use fallback
      questions = await extractWithFallback(text, reqId);
      modelUsed = 'openai-fallback';
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
    console.log(`🤖 Model: ${modelUsed}`);
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
      model: modelUsed
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
  console.log('🚀 AI Quiz System V6.0 CLAUDE TEXT');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🤖 Primary: ${CLAUDE_MODEL}`);
  console.log(`🔄 Backup: ${process.env.OPENAI_API_KEY ? 'OpenAI GPT-4' : 'None'}`);
  console.log('⭐ Strategy:');
  console.log('   - Claude 3.5 Sonnet (Arabic Master!)');
  console.log('   - Smart text understanding');
  console.log('   - Auto-correct garbled text');
  console.log('   - $0.08-0.10 per file');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
