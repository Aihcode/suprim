#!/usr/bin/env bash
# Cambia el motor de base de datos de Prisma sin reescribir código.
# Uso: ./scripts/switch-db.sh sqlite|postgresql|mysql|sqlserver "-url-de-conexion-"
set -euo pipefail
cd "$(dirname "$0")/.."

PROVIDER="${1:-}"
URL="${2:-}"
if [[ ! "$PROVIDER" =~ ^(sqlite|postgresql|mysql|sqlserver)$ ]] || [ -z "$URL" ]; then
  echo "Uso: $0 sqlite|postgresql|mysql|sqlserver \"DATABASE_URL\"" >&2
  exit 1
fi

SCHEMA=prisma/schema.prisma
if ! grep -q 'provider *= *"' "$SCHEMA"; then
  echo "[switch-db] No se encontró el bloque datasource en $SCHEMA" >&2
  exit 1
fi

python3 - "$SCHEMA" "$PROVIDER" <<'PY'
import re, sys
path, provider = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
text = re.sub(r'(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"', rf'\1"{provider}"', text, count=1, flags=re.S)
open(path, 'w', encoding='utf-8').write(text)
PY

if [ -f .env ]; then
  python3 - .env "$URL" <<'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
if re.search(r'^DATABASE_URL=', text, flags=re.M):
    text = re.sub(r'^DATABASE_URL=.*$', 'DATABASE_URL="' + url + '"', text, count=1, flags=re.M)
else:
    text += '\nDATABASE_URL="' + url + '"\n'
open(path, 'w', encoding='utf-8').write(text)
PY
fi

echo "[switch-db] Motor: $PROVIDER. Regenerando cliente y aplicando esquema..."
npx prisma generate
npx prisma db push
echo "[switch-db] Listo. Reinicia el servidor con npm run dev"
