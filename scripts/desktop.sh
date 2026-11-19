#!/usr/bin/env bash
# Arranca el agente PrintBridge Desktop en modo demostración (sin impresoras reales).
set -euo pipefail
cd "$(dirname "$0")/../desktop"
python3 -m printbridge.main --demo --console
