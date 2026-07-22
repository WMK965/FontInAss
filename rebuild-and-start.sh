#!/usr/bin/env bash
# rebuild-and-start.sh
# Rebuild the Docker image and restart the container via docker compose.
# Usage: ./rebuild-and-start.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Build first so the current container keeps serving during compilation.
echo "🔨 Building Docker image…"
docker compose build --no-cache

echo "🚀 Starting container…"
docker compose up -d --force-recreate --remove-orphans

# Confirm the v2 health contract, not only that the process is running.
echo "⏳ Waiting for health check…"
for _ in $(seq 1 24); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' fontinass-local 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    docker exec fontinass-local bun -e "const h=process.env.API_KEY?{'X-API-Key':process.env.API_KEY}:{};const r=await fetch('http://127.0.0.1:3000/api/health',{headers:h});const j=await r.json();if(!r.ok||j.version!==2)process.exit(1);console.log(JSON.stringify(j))"
    echo "✅ FontInAss v2 is healthy — http://localhost:3300"
    docker compose ps
    exit 0
  fi
  if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ]; then break; fi
  sleep 5
done

echo "❌ Container failed the v2 health check" >&2
docker compose logs --tail=80
exit 1
