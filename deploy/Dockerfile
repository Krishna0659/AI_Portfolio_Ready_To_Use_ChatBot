FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/extraction/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/parser && /opt/parser/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN IDENTITY_DATABASE_URL=postgresql://build@localhost/build WORKER_DATABASE_URL=postgresql://build@localhost/build NEXT_TELEMETRY_DISABLED=1 npm run build
RUN mkdir -p .local/objects && chown -R node:node /app/.local /app/.next
USER node
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PYTHON_PATH=/opt/parser/bin/python RAG_PYTHON=/opt/parser/bin/python
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
