#!/usr/bin/env bash
set -euo pipefail

# Root of the repo (script lives in scripts/)
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[start_all] KILL ports 5000 and 5173 if any"
for p in 5000 5173; do
  lsof -ti:"$p" | xargs -r kill -9 || true
done

echo "[start_all] Bringing down docker-compose services (if any)"
docker-compose down || true

echo "[start_all] Starting docker-compose services"
docker-compose up -d

echo "[start_all] Waiting for MySQL (127.0.0.1:3306) to accept connections"
for i in {1..30}; do
  if bash -c "</dev/tcp/127.0.0.1/3306" >/dev/null 2>&1; then
    echo "[start_all] MySQL is reachable"
    break
  fi
  echo "[start_all] waiting for mysql... ($i/30)"
  sleep 1
done

mkdir -p logs

echo "[start_all] Starting backend (npm run dev)"
cd backend
npm install --silent
nohup npm run dev --silent > "$ROOT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo "[start_all] backend pid=$BACKEND_PID"

echo "[start_all] Starting frontend (npm run dev)"
cd ../frontend
npm install --silent
if [ "${EXPOSE_FRONTEND:-0}" = "1" ]; then
  nohup npm run dev -- --host > "$ROOT_DIR/logs/frontend.log" 2>&1 &
else
  nohup npm run dev > "$ROOT_DIR/logs/frontend.log" 2>&1 &
fi
FRONTEND_PID=$!
echo "[start_all] frontend pid=$FRONTEND_PID"

echo "[start_all] Done. Backend log: logs/backend.log  Frontend log: logs/frontend.log"
echo "To expose frontend externally set EXPOSE_FRONTEND=1 when running this script."

exit 0
