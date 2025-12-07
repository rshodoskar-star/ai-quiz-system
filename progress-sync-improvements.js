// ============================================
// AI Quiz System - Progress Bar Improvements
// التحسينات على نظام Progress Bar
// ============================================

// استبدل الأكواد التالية في index.html

// ====================================
// 1. المتغيرات المحدثة (السطر 746-758)
// ====================================

const progressStages = [
    { start: 0, end: 10, speed: 0.3, text: 'رفع الملف...' },
    { start: 10, end: 25, speed: 0.2, text: 'استخراج النص من PDF...' },
    { start: 25, end: 45, speed: 0.15, text: 'تحليل المحتوى...' },
    { start: 45, end: 65, speed: 0.12, text: 'البحث عن الأسئلة...' },
    { start: 65, end: 80, speed: 0.08, text: 'استخراج الخيارات...' },
    { start: 80, end: 90, speed: 0.05, text: 'التحقق من الجودة...' }
];

let currentProgress = 0;
let currentStageIndex = 0;
let progressInterval = null;
let progressPollInterval = null;
let processingComplete = false;
let serverProgress = 0;
let currentRequestId = null;

// ====================================
// 2. دالة startSmartProgress المحدثة (السطر 760-799)
// ====================================

function startSmartProgress() {
    currentProgress = 0;
    currentStageIndex = 0;
    processingComplete = false;
    serverProgress = 0;
    
    const progressFill = document.getElementById('progressBarFill');
    const progressText = document.getElementById('progressText');
    const progressStage = document.getElementById('progressStage');
    
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    progressStage.textContent = progressStages[0].text;
    
    // Local progress simulation
    progressInterval = setInterval(() => {
        // Don't go beyond 90% without server confirmation
        if (currentProgress >= 90 && !processingComplete) {
            return;
        }
        
        if (currentStageIndex >= progressStages.length) {
            if (processingComplete) {
                completeProgress();
            }
            return;
        }
        
        const stage = progressStages[currentStageIndex];
        const increment = stage.speed;
        
        currentProgress += increment;
        
        if (currentProgress >= stage.end) {
            currentProgress = stage.end;
            currentStageIndex++;
            
            if (currentStageIndex < progressStages.length) {
                progressStage.textContent = progressStages[currentStageIndex].text;
            }
        }
        
        // Use the higher of local or server progress
        const displayProgress = Math.max(currentProgress, serverProgress);
        progressFill.style.width = displayProgress + '%';
        progressText.textContent = Math.round(displayProgress) + '%';
        
    }, 100);
}

// ====================================
// 3. دالة جديدة: pollServerProgress
// ====================================

function pollServerProgress(requestId) {
    // Poll server every 1 second for real progress
    progressPollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${API_URL}/api/progress/${requestId}`);
            const data = await res.json();
            
            if (data.progress > 0) {
                serverProgress = data.progress;
                
                // Update UI with server progress if it's higher
                if (serverProgress > currentProgress) {
                    currentProgress = serverProgress;
                    document.getElementById('progressBarFill').style.width = serverProgress + '%';
                    document.getElementById('progressText').textContent = Math.round(serverProgress) + '%';
                }
                
                // Update stage message from server
                if (data.message) {
                    document.getElementById('progressStage').textContent = data.message;
                }
            }
            
            // Check if processing is complete
            if (data.progress >= 100) {
                clearInterval(progressPollInterval);
                processingComplete = true;
            }
            
            // Check for errors
            if (data.error) {
                clearInterval(progressPollInterval);
                clearInterval(progressInterval);
                hideLoading();
                showAlert(data.message || 'حدث خطأ أثناء المعالجة', 'error');
            }
        } catch (err) {
            console.error('Poll error:', err);
        }
    }, 1000);
}

// ====================================
// 4. دالة جديدة: stopProgressPolling
// ====================================

function stopProgressPolling() {
    if (progressPollInterval) {
        clearInterval(progressPollInterval);
        progressPollInterval = null;
    }
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

// ====================================
// 5. دالة handleFileUpload المحدثة (السطر 831-900)
// ====================================

async function handleFileUpload(file) {
    if (!file) return;

    if (file.type !== 'application/pdf') {
        showAlert('يجب أن يكون الملف من نوع PDF', 'error');
        return;
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
        showAlert('حجم الملف أكبر من 50 ميجابايت', 'error');
        return;
    }

    // Generate unique request ID
    currentRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Start smart progress
    showLoading();
    startSmartProgress();
    
    // Start polling server for progress
    pollServerProgress(currentRequestId);

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`${API_URL}/api/quiz-from-pdf`, {
            method: 'POST',
            body: formData,
            headers: {
                'X-Request-ID': currentRequestId // Send request ID to server
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            processingComplete = true;
            
            // Wait for progress to reach 100%
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (currentProgress >= 100) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                
                // Timeout after 5 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                }, 5000);
            });
            
            // Stop polling
            stopProgressPolling();
            
            // Store questions and show settings
            questions = data.questions || [];
            console.log(`✅ Received ${questions.length} questions`);
            
            showSettings(data);
        } else {
            throw new Error(data.error || 'فشل استخراج الأسئلة');
        }
    } catch (error) {
        console.error('Upload error:', error);
        stopProgressPolling();
        hideLoading();
        showAlert(error.message || 'حدث خطأ أثناء رفع الملف', 'error');
    }
}

// ====================================
// 6. تحديث دالة showSettings (السطر 902-920)
// ====================================

function showSettings(data) {
    if (!data.questions || data.questions.length === 0) {
        hideLoading();
        showAlert('لم يتم العثور على أسئلة في الملف', 'error');
        return;
    }

    questions = data.questions;
    
    // Update total questions info
    document.getElementById('totalQuestionsInfo').textContent = questions.length;

    // Populate chapters
    const chapterSelect = document.getElementById('chapterSelect');
    chapterSelect.innerHTML = '<option value="all">جميع الفصول</option>';
    
    if (data.chapters && data.chapters.length > 0) {
        data.chapters.forEach(chapter => {
            if (chapter) {
                const option = document.createElement('option');
                option.value = chapter;
                option.textContent = chapter;
                chapterSelect.appendChild(option);
            }
        });
    }

    hideLoading();
    showScreen('settingsScreen');
    showAlert(`✅ تم استخراج ${questions.length} سؤال بنجاح!`, 'success');
}

// ====================================
// 7. ملاحظات التطبيق
// ====================================

/*
خطوات التطبيق في index.html:

1. استبدل المتغيرات من السطر 746-758 بالمتغيرات المحدثة
2. استبدل دالة startSmartProgress من السطر 760-799
3. أضف الدوال الجديدة: pollServerProgress و stopProgressPolling
4. استبدل دالة handleFileUpload بالنسخة المحدثة
5. تأكد من تحديث دالة showSettings

البديل: انسخ هذا الملف بالكامل واستبدل القسم <script> في index.html
*/
