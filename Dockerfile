FROM python:3.10-slim

# Fix system dependencies
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    libstdc++6 \
    libjpeg62-turbo \
    libpng16-16 \
    libfreetype6 \
    liblcms2-2 \
    libwebp7 \
    libtiff6 \
    libopenjp2-7 \
    libxcb1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/

RUN pip install --upgrade pip setuptools wheel

# Install OCR + PDF + ML libs
RUN pip install paddlepaddle==2.5.2 -i https://mirror.baidu.com/pypi/simple \
    && pip install paddleocr \
    && pip install opencv-python-headless \
    && pip install PyMuPDF ftfy regex fastapi uvicorn python-multipart

# Copy app
COPY . /app

EXPOSE 8000

CMD ["python3", "server-v8.0-PROFESSIONAL.js"]
