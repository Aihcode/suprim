#!/usr/bin/env bash
# Arranca el servidor de producción (requiere npm run build previo).
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm start
