#!/usr/bin/env bash
# Prueba de humo: comprueba que el servidor y los endpoints públicos respondan.
set -euo pipefail
BASE="${APP_URL:-http://localhost:3000}"
pass=0
fail=0

check() {
  local label="$1" url="$2" expected="${3:-200}"
  local code
  code=$(curl -s -o /tmp/opencode-smoke-body -w '%{http_code}' "$url" || true)
  if [ "$code" = "$expected" ]; then
    echo "  OK   $label ($code)"
    pass=$((pass+1))
  else
    echo "  FAIL $label (esperado $expected, obtenido $code)"
    fail=$((fail+1))
  fi
}

echo "[smoke] Páginas públicas"
check "Landing" "$BASE/"
check "Cotizador" "$BASE/quote"
check "Login" "$BASE/login"
check "Registro" "$BASE/register"

echo "[smoke] API pública"
check "Health" "$BASE/api/health"
check "Sesión NextAuth" "$BASE/api/auth/session"

echo "[smoke] Cotización"
quote_code=$(curl -s -o /tmp/opencode-quote -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d '{"file_pages":60,"copies":2,"color":false,"duplex":true,"paper_size":"A4"}' \
  "$BASE/api/quote/calculate" || true)
if [ "$quote_code" = "200" ]; then
  echo "  OK   POST /api/quote/calculate ($quote_code)"
  cat /tmp/opencode-quote
  echo
  pass=$((pass+1))
else
  echo "  FAIL POST /api/quote/calculate ($quote_code)"
  fail=$((fail+1))
fi

echo
echo "[smoke] $pass correctas, $fail fallidas"
[ "$fail" -eq 0 ]
