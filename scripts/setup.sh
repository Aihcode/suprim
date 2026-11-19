#!/usr/bin/env bash
# Prepara el entorno completo: dependencias, Prisma, base SQLite y datos de prueba.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[setup] Creado .env desde .env.example"
fi

echo "[setup] Instalando dependencias Node..."
npm install

echo "[setup] Generando Prisma Client..."
npx prisma generate

echo "[setup] Creando base de datos SQLite y tablas..."
npx prisma db push

echo "[setup] Cargando datos de prueba..."
npm run db:seed

echo
echo "[setup] Listo. Arranca con: npm run dev"
