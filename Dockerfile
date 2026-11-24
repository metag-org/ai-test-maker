# ==============================================================================
# Stage 1: Build React + Vite Frontend (with offline Japanese fonts bundled)
# ==============================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend

COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Lightweight Python FastAPI + OpenCV Runtime (No Chromium)
# ==============================================================================
FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data/uploads \
    STATIC_DIR=/app/static

# OpenCV headless minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-builder /build/frontend/dist ./static

RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh && mkdir -p /app/data/uploads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
