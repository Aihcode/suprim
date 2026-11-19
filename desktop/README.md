# PrintBridge Desktop

Agente nativo de estación de impresión para **PrintFlow ERP**. Descubre impresoras
(locales/USB, LAN IPP 631, RAW 9100, mDNS, SMB), lee telemetría del spooler,
recibe trabajos pagados por Socket.io (namespace `/station`) con token JWT de
estación, imprime sin diálogos y reporta progreso. Si cae la red, persiste el
trabajo en SQLite y lo sincroniza después.

## Estructura

```
desktop/
├── printbridge/           # paquete Python 3.10+
│   ├── main.py            # CLI y orquestación de hilos
│   ├── config.py          # .env + validación
│   ├── auth.py            # JWT HS256 (PyJWT o HMAC manual)
│   ├── crypto.py          # AES-256-GCM / borrado seguro
│   ├── local_queue.py     # SQLite de contingencia
│   ├── discovery.py       # escaneo de impresoras
│   ├── spooler.py         # win32print / lp / RAW
│   ├── printer_job.py     # ejecutor de print.job
│   ├── ws_client.py       # Socket.io + Engine.IO + REST fallback
│   ├── console.py         # consola Tkinter
│   └── tray.py            # pystray + autostart
├── resources/             # icon.png, icon.ico, printbridge.desktop
├── build/nsis/            # instalador Windows
├── .env.example
├── requirements.txt
└── pyproject.toml
```

## Instalación

```bash
cd desktop
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows: copy .env.example .env
# Windows además:  pip install pywin32
# Linux (opcional): sudo apt install python3-tk cups-client
#                   pip install pycups zeroconf
```

No instales dependencias para **probar la sintaxis**: `python3 -m compileall -q desktop`.
Todas las librerías son opcionales en tiempo de ejecución: si falta alguna, se
registra un aviso y el agente degrada sus funciones sin crashear.

## Emparejamiento (token de estación)

1. En el panel Admin de PrintFlow ERP abre **Estaciones (PrintBridge)** y registra
   esta computadora (nombre, `computer_name`, sistema operativo).
2. Copia el `station_id` y el **JWT de estación** generados.
3. Pégalos en `desktop/.env` (`STATION_ID`, `STATION_TOKEN`) o en la pestaña
   **Configuración** de la consola y pulsa **Guardar y reconectar**.
4. La consola debe pasar a **EN LÍNEA**; el backend recibe `printer.status` y
   `station.heartbeat` cada 30 s. El token se renueva desde el panel Admin o con
   `POST /api/station/token/refresh`.

Fuera de DEMO, `STATION_ID` y `STATION_TOKEN` son obligatorios. La verificación
local del JWT usa `JWT_SECRET`/`NEXTAUTH_SECRET` si están disponibles; el backend
siempre vuelve a validar el token.

## Ejecución

```bash
# Producción (consola + bandeja)
python3 -m printbridge.main --console --tray

# Sólo bandeja / sólo servicio
python3 -m printbridge.main --tray
python3 -m printbridge.main

# Sin backend ni impresoras (pruebas)
python3 -m printbridge.main --demo --console

# Autostart
python3 -m printbridge.main --install-autostart
python3 -m printbridge.main --uninstall-autostart
```

Opciones: `--config RUTA` (otro `.env`), `--log-level DEBUG`.
También funciona como script: `python3 desktop/printbridge/main.py --demo`.

### Modo DEMO

`--demo` (o `DEMO_MODE=true`) activa dos impresoras simuladas (`ONLINE` y
`LOW_TONER`), generación local de un PDF de prueba y progreso simulado, tolerando
que el backend esté caído. Es ideal para probar UI y flujos sin hardware.

> **ADVERTENCIA DE SEGURIDAD:** el modo DEMO puede usar un cifrado XOR+SHA-256
> **INSEGURO** cuando `cryptography` no está instalado y acepta tokens opacos.
> Nunca lo actives en producción ni con documentos reales de clientes.

## Comportamiento en detalle

- **WS:** usa `python-socketio[client]`; si no está, handshake Engine.IO v4
  (`GET /socket.io/?EIO=4&transport=polling` → sid → upgrade WebSocket →
  `40/station,` → `42/station,["station.auth", …]`), con `2`/`3` cada 30 s.
  Reconexión exponencial 1, 2, 4, 8 y 30 s.
- **Fallback REST:** cada 10 s sin WS, `GET /api/station/jobs/pending` con
  `Authorization: Bearer <token>`; progreso por
  `POST /api/station/jobs/:job_id/progress` y sincronización por
  `POST /api/station/jobs/sync`.
- **Impresión:** archivos descargados a un `TemporaryDirectory` aislado,
  descifrados (AES-256-GCM), verificados por SHA-256 y borrados con
  sobrescritura de ceros. Parámetros: copias, rango de páginas, color, dúplex,
  tamaño y bandeja. Nunca se abre un diálogo de impresión.
- **Contingencia:** si la red falla tras la descarga, el trabajo se guarda en
  `local_queue.db` con estado `LOCAL_QUEUE`, se imprime de todas formas y se
  reporta al recuperar conexión.

## Solución de problemas

| Síntoma | Causa / solución |
|---------|------------------|
| No aparece la consola | Instala `python3-tk` (Linux) o revisa el log: se activa modo solo-log. |
| Sin icono en bandeja | Instala `pystray` y `Pillow`; en servidores headless se omite con aviso. |
| "Faltan variables obligatorias" | Configura `STATION_ID` y `STATION_TOKEN` en `.env` o usa `--demo`. |
| No detecta impresoras | Windows: `pywin32`. Linux: `lpstat`, `lp` y opcionalmente `pycups`. Revisa `NETWORK_SCAN_ENABLED`. |
| Impresora en `OFFLINE` | Verifica CUPS (`lpstat -p`) o el spooler de Windows; usa la página de prueba. |
| Trabajo en `LOCAL_QUEUE` | Normal: espera a que vuelva la red o pulsa **Sincronizar ahora**. |
| `Checksum mismatch` | La clave `ENCRYPTION_KEY` no coincide con `FILE_ENCRYPTION_KEY` del backend. |

## Archivos generados enruntime (no versionar)

Añade al `.gitignore` de tu entorno, dentro de `desktop/`:

```
desktop/.env
desktop/local_queue.db
desktop/printbridge.log
desktop/.cache/
desktop/__pycache__/
```

## Empaquetado Windows

```bat
pyinstaller --noconsole --onefile --icon resources\icon.ico ^
  --add-data "resources;resources" printbridge\main.py
makensis build\nsis\printbridge.nsi
```

El instalador instala en `Program Files`, crea atajos, registra el inicio
automático y genera el desinstalador.
