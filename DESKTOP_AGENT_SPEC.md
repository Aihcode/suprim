# DESKTOP_AGENT_SPEC.md — PrintBridge Desktop Agent

Especificación técnica del agente de escritorio `PrintBridge Desktop`: protocolo de comunicación, manejo de spooler local/red, emparejamiento por código/token de estación y recuperación ante fallos (modo contingencia).

## 1. Visión General

`PrintBridge Desktop` es una aplicación nativa de escritorio instalable (Windows / Linux / macOS) que se ejecuta en las estaciones de impresión. Actúa como puente entre la plataforma web PrintFlow ERP y el hardware de impresión local: descubre impresoras, lee telemetría del spooler del SO, recibe trabajos pagados vía WebSocket seguro, imprime sin diálogos emergentes y reporta progreso en tiempo real.

## 2. Stack Tecnológico

- **Lenguaje:** Python 3.10+
- **UI:** Tkinter (consola visual local del operador)
- **Bandeja del sistema:** pystray (icono de sistema tray, inicio automático con el SO)
- **Comunicación:** `websocket-client` (WS/TLS + Token de Estación JWT), fallback REST (HTTP polling cada 10s si WS cae)
- **Impresión:**
  - Windows: `pywin32` (win32print, win32api) — spooler nativo de Windows
  - Linux: CUPS (`pycups` / subprocess `lp`, `lpstat`, `cancel`)
  - mDNS/Bonjour discovery: `zeroconf`
- **Cifrado:** `cryptography` (AES-256-GCM) para archivos temporales descargados
- **Empaquetado:** PyInstaller (Windows .exe / NSIS instalador), Linux .deb/.rpm

## 3. Arquitectura del Agente

```
desktop/
├── printbridge/
│   ├── __init__.py
│   ├── main.py              # Punto de entrada (tray + consola)
│   ├── config.py            # Carga de .env, URLs, token de estación
│   ├── auth.py              # Validación de token JWT de estación
│   ├── discovery.py         # Autodescubrimiento de impresoras (USB, LAN, IPP, CUPS, mDNS, TCP 9100)
│   ├── spooler.py           # Lectura/control de colas del SO (estado, pausa, reanuda, cancela)
│   ├── printer_job.py       # Ejecución silenciosa de trabajos de impresión
│   ├── ws_client.py         # Cliente WebSocket (conecta, heartbeat, reintentos, fallback REST)
│   ├── crypto.py            # Cifrado/descifrado AES-256-GCM de archivos temporales
│   ├── local_queue.py       # Cola local SQLite para modo contingencia
│   ├── console.py           # Consola visual Tkinter del operador
│   └── tray.py              # Icono de bandeja del sistema y menú
├── resources/
│   ├── icon.ico
│   ├── icon.png
│   └── printbridge.desktop
├── pyproject.toml
├── .env.example
├── requirements.txt
└── build/
    └── nsis/                # Script del instalador Windows
```

## 4. Protocolo de Comunicación (WebSocket)

### 4.1 Endpoint

`wss://<backend-host>/api/ws/station` (TLS 1.3 obligatorio)

### 4.2 Autenticación de Estación

Tras abrir el WebSocket, el agente envía inmediatamente un mensaje de autenticación:

**Cliente → Servidor (`station.auth`):**
```json
{
  "type": "station.auth",
  "station_id": "pc-01",
  "token": "<JWT de estación>",
  "computer_name": "IMPRENTA-PC-01",
  "os": "WINDOWS",
  "capabilities": ["print", "telemetry", "discovery"]
}
```

**Servidor → Cliente (`station.auth.ok` / `station.auth.fail`):**
```json
{ "type": "station.auth.ok", "station_id": "pc-01" }
{ "type": "station.auth.fail", "reason": "invalid_token" }
```

### 4.3 Mensajes del Servidor al Agente

**Nuevo trabajo de impresión (`print.job`):**
```json
{
  "type": "print.job",
  "job_id": "job_123",
  "order_id": "ord_456",
  "station_id": "pc-01",
  "file_url": "https://storage.example.com/enc/file.bin",
  "file_encrypted": true,
  "file_checksum": "sha256:abc...",
  "parameters": {
    "copies": 2,
    "page_range": "1-3,5",
    "color": false,
    "duplex": true,
    "paper_size": "A4",
    "tray": "default"
  },
  "printer_id": "printer_789",
  "encryption_key_b64": "<base64 AES-256 key>",
  "iv_b64": "<base64 IV>"
}
```

**Control de cola (`print.control`):**
```json
{
  "type": "print.control",
  "job_id": "job_123",
  "action": "pause|resume|cancel|test_page"
}
```

**Solicitud de telemetría inmediata (`telemetry.request`):**
```json
{ "type": "telemetry.request", "station_id": "pc-01" }
```

### 4.4 Mensajes del Agente al Servidor

**Estado de impresoras / telemetría (`printer.status`):**
```json
{
  "type": "printer.status",
  "station_id": "pc-01",
  "printers": [
    {
      "printer_id": "printer_789",
      "name": "HP LaserJet Pro",
      "status": "ONLINE", // ONLINE, PRINTING, NO_PAPER, JAM, LOW_TONER, OFFLINE, PAUSED
      "message": "Listo",
      "timestamp": "2026-11-19T14:13:00Z"
    }
  ]
}
```

**Progreso de trabajo (`job.progress`):**
```json
{
  "type": "job.progress",
  "job_id": "job_123",
  "order_id": "ord_456",
  "status": "RECEIVED|DOWNLOADING|PRINTING|COMPLETED|FAILED|CANCELLED|LOCAL_QUEUE",
  "page_current": 5,
  "page_total": 20,
  "message": "Imprimiendo página 5 de 20",
  "timestamp": "2026-11-19T14:13:05Z"
}
```

**Heartbeat / latitud (`station.heartbeat`):**
```json
{ "type": "station.heartbeat", "station_id": "pc-01", "timestamp": "..." }
```

**Error (`agent.error`):**
```json
{ "type": "agent.error", "job_id": "job_123", "code": "PRINTER_OFFLINE", "message": "Impresora no responde" }
```

### 4.5 Heartbeat y Reconexión

- El agente envía `station.heartbeat` cada 30s.
- El servidor considera la estación `OFFLINE` tras 90s sin heartbeat.
- Si el WebSocket se cae, el agente reintentaría con backoff exponencial (1s, 2s, 4s, 8s, 30s…).
- Durante la caída, el agente usa polling REST cada 10s a `GET /api/station/jobs/pending` (auth: header `Authorization: Bearer <token>`).

## 5. Autodescubrimiento de Impresoras

El agente detecta al iniciar y cada 5 minutos:

1. **Impresoras locales/USB:** spooler del SO (Windows `EnumPrinters`, Linux `cupsGetPrinters`).
2. **Impresoras compartidas SMB/Windows:** exploración de red SMB.
3. **Dispositivos LAN:** IPP (puerto 631), CUPS, WSD, mDNS/Bonjour (`zeroconf`), puerto TCP RAW 9100.
4. **Capacidades reportadas:** color, dúplex, bandejas, tamaños de papel soportados.

Resultado: lista de impresoras con `printer_id`, `name`, `type` (`LOCAL`/`NETWORK`/`SHARED`), `ip`, `port`, `protocol`, `capabilities`.

El operador mapea desde el panel Admin qué impresoras físicas se exponen a la plataforma web.

## 6. Control del Spooler Local

Acciones soportadas por impresora:

- **Leer estado real:** `Lista`, `Imprimiendo`, `Sin papel`, `Atasco`, `Tóner bajo`, `Desconectada`, `Pausada`.
- **Pausar / reanudar cola.**
- **Cancelar trabajos atascados.**
- **Imprimir página de prueba.**

## 7. Ejecución Silenciosa de Trabajos

Flujo por trabajo recibido:

1. Validar token de estación y firma del trabajo.
2. Descargar el documento cifrado desde `file_url` (temporal en carpeta aislada del agente).
3. Descifrar con AES-256-GCM usando `encryption_key_b64` + `iv_b64`.
4. Validar `file_checksum` (SHA-256).
5. Aplicar parámetros (copias, rango de páginas, color/B&N, dúplex, tamaño, bandeja) al motor nativo de impresión del SO.
6. Imprimir sin diálogos emergentes (`PrintDocument` silencioso en Windows, `lp -o raw` sin UI en Linux).
7. Reportar progreso página por página (`job.progress`).
8. Tras confirmar impresión, eliminar archivo temporal (borrado seguro).
9. Reportar `job.progress` estado `COMPLETED`.

## 8. Modo Contingencia / Cola Local

Si se corta el internet mientras un trabajo ya fue descargado y pagado:

1. El agente marca el trabajo como `LOCAL_QUEUE` y lo persiste en una cola local SQLite (`desktop/printbridge/local_queue.db`).
2. Completa la impresión localmente usando el spooler.
3. Al recuperar conexión, sincroniza estados pendientes con el backend vía WebSocket o REST (`POST /api/station/jobs/sync`).
4. El backend actualiza el estado final de la orden (`COMPLETED` / `FAILED`).

Esquema de cola local:
```sql
CREATE TABLE local_jobs (
  job_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  parameters JSON NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
```

## 9. Emparejamiento de Estación

Cada computadora tiene un `station_id` y un `token` (JWT) generados en el panel Admin. El operador instala el agente, ingresa el `station_id` y el `token` en la consola local o `.env`. El agente se registra ante el backend; el backend valida el token y asocia la estación.

El token se rota periódicamente; el agente debe renovarlo mediante `POST /api/station/token/refresh`.

## 10. Seguridad

- **TLS 1.3** en WebSocket entre backend y agente.
- **Token de Estación (JWT)** para autenticación del agente.
- **Archivos cifrados** (AES-256-GCM) en tránsito y almacenamiento temporal.
- Los archivos temporales se borran tras la impresión.
- Rate limiting en endpoints REST de estación.

## 11. Instalación y Arranque

- Windows: instalador NSIS, registro en inicio automático del SO, icono en bandeja del sistema.
- Linux: .deb/.rpm, systemd user service o autostart de escritorio, icono en bandeja (AppIndicator/pystray).
- macOS: .app, inicio automático mediante launchd.

Consola visual local del operador: estado de impresoras, trabajos en cola, botón pausa/reanuda/cancela, página de prueba.
