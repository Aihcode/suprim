#!/usr/bin/env bash
# Verificación rápida del ecosistema: esquema, tipos, sintaxis Python y build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[verify] Validando esquema Prisma..."
npx prisma validate

echo "[verify] Verificando TypeScript..."
npm run typecheck

echo "[verify] Compilando agente Python..."
python3 -m compileall -q desktop

echo "[verify] Compilando Next.js..."
npm run build

echo "[verify] Todo correcto."
