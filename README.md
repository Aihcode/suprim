# PrintFlow ERP & PrintBridge Desktop

Sistema integral de impresión online: **plataforma web** (cotización, pago y seguimiento), **backend/API** con orquestación en tiempo real y **agente nativo de escritorio** que controla las impresoras de las estaciones.

Construido a partir de [`s_drive_development.md`](./s_drive_development.md). La documentación técnica de referencia está en [`SPEC.md`](./SPEC.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DB_SCHEMA.md`](./DB_SCHEMA.md), [`API_CONTRACT.md`](./API_CONTRACT.md) y [`DESKTOP_AGENT_SPEC.md`](./DESKTOP_AGENT_SPEC.md).

Para llevarlo a producción: [`DEPLOYMENT.md`](./DEPLOYMENT.md) (VPS, Docker, HTTPS, webhooks y agente) y el [`guion del video tutorial`](./VIDEO_TUTORIAL.md) con narración y timecodes.

---

## 1. Arquitectura (3 capas)

| Capa | Tecnología | Entregable |
|---|---|---|
| Web | Next.js 14 (App Router), React 18, Tailwind CSS, Radix UI, Recharts, socket.io-client | Landing, cotizador, checkout, tracking, portal cliente, panel empleado, panel Admin estilo Odoo |
| Backend | Next.js API Routes, Prisma ORM, NextAuth.js, Socket.io, Stripe/PayPal webhooks | REST + WS, RBAC, cifrado de archivos, reglas de descuento, idempotencia de pagos |
| Escritorio | Python 3.10+, Tkinter, pystray, spooler nativo (pywin32/CUPS), WebSocket | `PrintBridge Desktop`: autodescubrimiento, telemetría, impresión silenciosa, cola local |

```
suprim/
├── src/app/            # Páginas y API Routes
├── src/components/     # Componentes UI reutilizables
├── src/lib/            # Prisma, auth, quote, pagos, cifrado, realtime
├── prisma/             # schema.prisma + seed
├── desktop/printbridge/# Agente de escritorio
├── scripts/            # setup, dev, start, desktop, switch-db
├── server.js           # Custom server Next.js + Socket.io
└── docs (raíz)         # SPEC / ARCHITECTURE / DB_SCHEMA / API_CONTRACT / DESKTOP_AGENT_SPEC
```

El flujo completo es:

1. El cliente sube un archivo y cotiza (páginas, copias, color, dúplex, tamaño).
2. Se aplican reglas de descuento e impresiones gratis configurables desde el Admin.
3. Stripe o PayPal confirman el pago mediante webhook validado e idempotente.
4. El backend crea un `PrintJob` y lo envía por Socket.io a la estación (`print.job`).
5. El agente descarga el archivo cifrado, lo descifra, imprime sin diálogos y reporta `job.progress` página por página.
6. El checkout y el panel Admin muestran el progreso en vivo. Si se corta la red, el agente usa su cola local y sincroniza después.

---

## 2. Arranque rápido (SQLite, sin servicios externos)

Requiere **Node.js >= 18.17** y **Python >= 3.10** (solo para el agente de escritorio).

```bash
./scripts/setup.sh     # npm install + prisma generate + db push + seed
npm run dev            # http://localhost:3000  (Next.js + Socket.io)
```

`setup.sh` copia `.env.example` a `.env`. La base por defecto es `file:./dev.db` (SQLite).

### Credenciales de prueba (creadas por el seed)

| Rol | Email | Password |
|---|---|---|
| Administrador | `admin@printflow.local` | `Admin123!` |
| Empleado | `employee@printflow.local` | `Employee123!` |
| Cliente | `client@printflow.local` | `Client123!` (10 páginas gratis) |

Estación de prueba: `PC-01` / `IMPRENTA-PC-01` (el token JWT se genera en el seed y se muestra por consola; también se puede copiar desde el panel Admin → Estaciones).

### Flujo demo end-to-end (sin claves de pago ni impresoras)

1. Abre `http://localhost:3000/quote`, sube un PDF (o introduce el número de páginas), cotiza.
2. Continúa al checkout y pulsa **Pagar (DEMO)**. El backend marca la orden como `PAID`, crea el trabajo y lo emite a la estación.
3. Arranca el agente: `./scripts/desktop.sh` (modo demo: imprime en una impresora simulada y reporta progreso).
4. La orden pasa a `COMPLETED` y el timeline del checkout se actualiza en vivo.

> El modo demo de pago (`DEMO_PAYMENTS=true` en `.env`) **solo debe usarse en desarrollo**. En producción se configura `STRIPE_SECRET_KEY` / `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` y se ponen los webhooks correspondientes.

---

## 3. Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo (custom server con Socket.io). |
| `npm run build` / `npm start` | Build y servidor de producción. |
| `npm run db:push` / `npm run db:seed` | Sincronizar esquema / recargar datos de prueba. |
| `npm run typecheck` | Verificación TypeScript. |
| `./scripts/setup.sh` | Preparación completa del entorno. |
| `./scripts/desktop.sh` | Agente PrintBridge en modo demostración. |
| `./scripts/switch-db.sh <motor> "<url>"` | Cambia SQLite → PostgreSQL/MySQL/SQL Server. |
| `docker compose -f docker-compose.postgres.yml up -d` | PostgreSQL opcional local. |

### Cambiar de motor de base de datos

El código usa siempre Prisma + patrón repositorio; no hay SQL específico de un motor en la lógica de negocio.

```bash
./scripts/switch-db.sh postgresql "postgresql://printflow:printflow@localhost:5432/printflow?schema=public"
# o: mysql, sqlserver, sqlite
```

El script ajusta el `provider` en `prisma/schema.prisma` y `DATABASE_URL` en `.env`, regenera el cliente y aplica el esquema. Reinicia el servidor después.

---

## 4. API y tiempo real

Contrato completo en [`API_CONTRACT.md`](./API_CONTRACT.md). Resumen:

- Públicas: `/api/auth/*`, `/api/quote/calculate`, `/api/health`.
- Cliente: `/api/client/orders*`, `/api/client/free-pages`.
- Empleado: `/api/employee/stations*`, `/api/employee/printers*`, `/api/employee/orders*`.
- Admin: `/api/admin/users*`, `/api/admin/discount-rules*`, `/api/admin/tariffs*`, `/api/admin/payments*`, `/api/admin/reports/*`, `/api/admin/db-config`.
- Estación: `/api/station/auth`, `/heartbeat`, `/jobs/pending`, `/jobs/:id/progress`, `/jobs/sync`, `/token/refresh`, `/printers`.
- Webhooks: `/api/webhooks/stripe`, `/api/webhooks/paypal`, `/api/payments/demo-confirm`.

Namespaces Socket.io: `/station` (agente), `/admin` y `/client` (paneles web). El agente se autentica con `station.auth` y entra al room `station:<id>`.

---

## 5. Seguridad

- Contraseñas con bcrypt; sesiones JWT de NextAuth; RBAC real (`CLIENT` / `EMPLOYEE` / `ADMIN`).
- Token JWT de estación para REST y WebSocket; rotación en `/api/station/token/refresh`.
- Archivos cifrados **AES-256-GCM** en repositorio temporal y borrado seguro tras imprimir.
- Webhooks con verificación criptográfica y tabla `WebhookEvent` para idempotencia: ningún trabajo se envía a impresora sin confirmación oficial de pago (el modo DEMO está explícitamente separado).
- Rate limiting por IP/token en API pública y de estación.
- HTTPS/WSS obligatorio en producción (configurar `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` y `WS_URL` del agente con `wss://`).

---

## 5.1 Observabilidad (LogRocket)

LogRocket es **opcional** y se activa únicamente si se define `NEXT_PUBLIC_LOGROCKET_APP_ID` en `.env`:

```env
NEXT_PUBLIC_LOGROCKET_APP_ID="tu-empresa/printflow-web"
NEXT_PUBLIC_LOGROCKET_RELEASE="v1.0.0"
# Opcional, solo si necesitas servir el SDK desde otro origen:
NEXT_PUBLIC_LOGROCKET_CDN="https://cdn.logrocket.io/LogRocket.min.js"
```

Con el App ID configurado, `src/components/LogRocketBootstrap.tsx` carga el SDK, identifica al usuario autenticado de NextAuth y registra navegación, errores no controlados, fallos 5xx de la API y eventos de negocio (`checkout_started`, `checkout_redirected`, `print_progress`, `print_completed`).

Privacidad: `src/lib/logrocket.ts` sanea por defecto contraseñas, emails, tokens, números de tarjeta y cabeceras `Authorization`/`Cookie`, y descarta peticiones a URLs con secretos. Los campos sensibles pueden marcarse en el DOM con `data-lp-sensitive="true"`. Sin App ID, todas las llamadas son no-op y no se descarga ningún script externo.

---

## 6. Agente PrintBridge Desktop

Ver [`desktop/README.md`](./desktop/README.md) y [`DESKTOP_AGENT_SPEC.md`](./DESKTOP_AGENT_SPEC.md).

```bash
cd desktop
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # STATION_ID + STATION_TOKEN desde el panel Admin
python -m printbridge.main --demo --console
```

Opciones: `--demo` (impresoras simuladas), `--console` (consola Tkinter), `--tray` (icono de bandeja), `--install-autostart` (inicio automático del SO). El agente degrada gracefully si faltan librerías nativas o no hay servidor gráfico.

---

## 7. Licencia

MIT — ver [`LICENSE`](./LICENSE).
