#!/usr/bin/env bash
# Arranca el servidor de desarrollo (Next.js + Socket.io) en http://localhost:3000
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run dev
