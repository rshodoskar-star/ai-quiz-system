# Dockerfile for AI Quiz System V7.0 PyMuPDF
# Python + Node.js in one container

FROM python:3.10-slim

# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy Python requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Node.js requirements and install
COPY package.json .
RUN npm install

# Copy application code
COPY . .

# Expose port (Railway will override with $PORT)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
