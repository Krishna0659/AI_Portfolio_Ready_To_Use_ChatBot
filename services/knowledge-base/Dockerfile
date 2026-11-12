FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/cache \
    TRANSFORMERS_CACHE=/models/cache

RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY requirements.txt constraints.txt ./
RUN pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', revision='1110a243fdf4706b3f48f1d95db1a4f5529b4d41').save('/opt/embedding-model')"
ENV KB_MODEL_PATH=/opt/embedding-model HF_HUB_OFFLINE=1
COPY app.py .
COPY ranking.py .
COPY chroma_transport.py .
COPY quotas.py .
COPY execution.py .
COPY credentials.py .
COPY fixtures ./fixtures
RUN mkdir -p /data /models/cache && chown -R app:app /app /data /models /opt/embedding-model
USER app
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
