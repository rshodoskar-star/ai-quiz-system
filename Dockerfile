# ====================================
# AI Quiz System V8.0 - Professional Dockerfile
# Python 3.10 + Node.js 20 + PaddleOCR
# FIXED: Use PyPI instead of Baidu mirror
# ====================================

FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    # OpenCV dependencies
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    libgomp1 \
    libstdc++6 \
    # Image libraries
    libjpeg62-turbo \
    libpng16-16 \
    libfreetype6 \
    liblcms2-2 \
    libwebp7 \
    libtiff6 \
    libopenjp2-7 \
    libxcb1 \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python requirements
COPY requirements.txt .

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

# Install PaddlePaddle CPU version (from official PyPI)
# Use paddlepaddle instead of paddlepaddle==2.5.2
RUN pip install --no-cache-dir paddlepaddle

# Install OCR and dependencies
RUN pip install --no-cache-dir \
    paddleocr \
    opencv-python-headless

# Install remaining Python packages
RUN pip install --no-cache-dir -r requirements.txt

# Try to download Arabic model (optional)
RUN python3 -c "from paddleocr import PaddleOCR; ocr = PaddleOCR(lang='ar', show_log=False)" || true

# Copy and install Node.js dependencies
COPY package.json .
RUN npm install --production

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
