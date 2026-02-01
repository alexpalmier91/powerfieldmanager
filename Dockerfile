FROM python:3.11-slim

# ========================================
# ENVIRONNEMENT
# ========================================
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# ========================================
# OS DEPS
# ========================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc libpq-dev curl \
    libcairo2 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libffi-dev \
    libgobject-2.0-0 \
    fonts-dejavu-core \
    libwebp7 libwebp-dev \
 && rm -rf /var/lib/apt/lists/*

# ========================================
# INSTALL DEPENDANCES PYTHON
# ========================================
WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# ========================================
# COPIE DU CODE
# ========================================
COPY . /app/

# ========================================
# VENDOR PDF.JS (local, fiable en prod)
# ========================================
ARG PDFJS_VERSION=3.11.174
RUN set -eux; \
    mkdir -p /app/app/static/vendor/pdfjs; \
    curl -fsSL "https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js" \
      -o /app/app/static/vendor/pdfjs/pdf.min.js; \
    curl -fsSL "https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js" \
      -o /app/app/static/vendor/pdfjs/pdf.worker.min.js; \
    test -s /app/app/static/vendor/pdfjs/pdf.min.js; \
    test -s /app/app/static/vendor/pdfjs/pdf.worker.min.js

# ========================================
# HEALTHCHECK (facultatif)
# ========================================
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1
