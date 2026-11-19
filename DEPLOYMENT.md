# Guía de despliegue — PrintFlow ERP & PrintBridge Desktop

Esta guía acompaña al [guion del video tutorial](./VIDEO_TUTORIAL.md). Cubre desde el arranque local hasta un despliegue de producción con HTTPS, webhooks de pago y agentes de escritorio.

---

## 0. Restricción arquitectónica importante

El backend usa un **custom server de Node** (`server.js`) que hospeda Next.js **y** Socket.io en el mismo proceso. Eso significa:

- ✅ Se despliega en **VPS, VM, contenedor Docker o un servicio que permita un proceso Node largo** (Railway, Render, Fly.io, etc.).
- ⚠️ **No se puede desplegar tal cual en Vercel serverless**: las API Routes funcionan, pero el servidor WebSocket no. Para Vercel habría que mover Socket.io a un servicio independiente (por ejemplo, un contenedor en Fly.io/Railway) y apuntar el agente y los paneles a ese host.

`ARCHITECTURE.md` menciona Vercel como opción histórica; para esta implementación con WS integrado, la opción recomendada es VPS o Docker.

---

## 1. Requisitos

| Entorno | Requisitos |
|---|---|
| Local | Node.js ≥ 18.17, Python ≥ 3.10 (solo agente), 2 GB RAM |
| Producción | Ubuntu 22.04/24.04, 2 vCPU, 4 GB RAM, dominio + DNS, puerto 80/443 abierto |
| Opcional | PostgreSQL 14+, Docker + Compose, Stripe/PayPal, App ID de LogRocket |

---

## 2. Arranque local (5 minutos)

```bash
cd suprim
./scripts/setup.sh          # npm install + prisma generate + db push + seed
npm run dev                 # http://localhost:3000
```

`setup.sh` crea `.env` desde `.env.example`. SQLite se crea en `prisma/dev.db`.

**Credenciales del seed**

| Rol | Email | Password |
|---|---|---|
| ADMIN | `admin@printflow.local` | `Admin123!` |
| EMPLOYEE | `employee@printflow.local` | `Employee123!` |
| CLIENT | `client@printflow.local` | `Client123!` |

**Verificación**

```bash
./scripts/smoke-test.sh
```

Comprueba landing, cotizador, login, `/api/health`, `/api/auth/session` y `POST /api/quote/calculate`.

---

## 3. Variables de entorno (producción)

Copia `.env.example` a `.env` y revisa **al menos** estas:

```env
DATABASE_URL="file:./dev.db"          # o postgresql://...
NEXT_PUBLIC_APP_URL="https://tudominio.com"
PORT=3000
HOST=0.0.0.0

NEXTAUTH_URL="https://tudominio.com"
NEXTAUTH_SECRET="<openssl rand -base64 32>"
JWT_SECRET="<openssl rand -base64 32>"
FILE_ENCRYPTION_KEY="<64 caracteres hex = 32 bytes>"
UPLOAD_DIR="./uploads"

STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
PAYPAL_CLIENT_ID="..."
PAYPAL_CLIENT_SECRET="..."
PAYPAL_WEBHOOK_ID="..."
PAYPAL_MODE="live"
DEMO_PAYMENTS="false"                 # ← obligatorio en producción

NEXT_PUBLIC_LOGROCKET_APP_ID="tu-empresa/printflow-web"   # opcional
NEXT_PUBLIC_LOGROCKET_RELEASE="v1.0.0"
```

Genera secretos:

```bash
openssl rand -base64 32
openssl rand -hex 32        # para FILE_ENCRYPTION_KEY
```

> ⚠️ Si cambias `FILE_ENCRYPTION_KEY` con archivos ya cifrados en `uploads/`, esos trabajos dejarán de poder descifrarse. Rota la clave solo cuando no haya trabajos pendientes.

---

## 4. Opción A — VPS con PM2 + Nginx + HTTPS

### 4.1 Preparar el servidor

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx certbot python3-certbot-nginx curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 4.2 Desplegar la app

```bash
sudo mkdir -p /opt/printflow && sudo chown -R $USER:$USER /opt/printflow
cd /opt/printflow
git clone <tu-repo> .
cp .env.example .env       # edita los valores de producción
npm ci --no-audit --no-fund
npx prisma generate
npx prisma db push         # o migrate deploy si usas migraciones
npm run db:seed            # solo la primera vez
npm run build
pm2 start npm --name printflow -- start
pm2 save && pm2 startup
```

### 4.3 Nginx con WebSocket

`/etc/nginx/sites-available/printflow`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name tudominio.com;

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;

    client_max_body_size 25M;   # límite de subida: 20 MB + overhead

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;    # WebSocket + trabajos largos
    }
}
```

```bash
sudo certbot --nginx -d tudominio.com
sudo ln -sf /etc/nginx/sites-available/printflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -I https://tudominio.com/api/health
```

### 4.4 Actualizaciones

```bash
cd /opt/printflow
git pull
npm ci --no-audit --no-fund
npx prisma generate
npm run build
pm2 restart printflow
```

---

## 5. Opción B — Docker Compose

Incluye `Dockerfile`, `.dockerignore` y `docker-compose.yml` en la raíz.

```bash
cp .env.example .env        # ajusta NEXT_PUBLIC_APP_URL, secretos, DEMO_PAYMENTS=false
docker compose up -d --build
docker compose logs -f app
curl http://localhost:3000/api/health
```

- Los archivos cifrados se persisten en el volumen `uploads`.
- La base SQLite se persiste en el volumen `appdata` (`/app/prisma`).
- Para PostgreSQL: `./scripts/switch-db.sh postgresql "postgresql://printflow:printflow@db:5432/printflow?schema=public"` y añade el servicio `db` (hay un ejemplo en `docker-compose.postgres.yml`).

---

## 6. Base de datos

Cambiar de motor sin reescribir código:

```bash
./scripts/switch-db.sh postgresql "postgresql://user:pass@host:5432/printflow?schema=public"
# también: mysql, sqlserver, sqlite
```

El script actualiza el `provider` de `prisma/schema.prisma` y `DATABASE_URL` en `.env`, regenera el cliente y aplica el esquema. Prisma no permite provider dinámico en runtime, por eso se requiere regenerar y reiniciar.

---

## 7. Webhooks de pago

### Stripe

1. En Stripe Dashboard → Developers → Webhooks → Add endpoint:
   `https://tudominio.com/api/webhooks/stripe`
2. Eventos: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`.
3. Copia el *Signing secret* a `STRIPE_WEBHOOK_SECRET`.
4. Prueba local con Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```

### PayPal

1. Developer Dashboard → Webhooks → `https://tudominio.com/api/webhooks/paypal`.
2. Eventos: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`.
3. Configura `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` y `PAYPAL_MODE=live`.

El backend verifica la firma criptográfica y usa `WebhookEvent` + `Payment.providerId` como idempotencia: **ningún trabajo llega a la impresora sin confirmación oficial de pago**. El botón DEMO solo existe con `DEMO_PAYMENTS=true`.

---

## 8. Agente PrintBridge Desktop

1. En el panel **Admin → Estaciones** (o Empleado → Estaciones), crea una estación y copia su token JWT.
2. En la PC de impresión:

```bash
cd desktop
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# edita STATION_ID, STATION_TOKEN, BACKEND_URL=https://tudominio.com, WS_URL=wss://tudominio.com/socket.io
python -m printbridge.main --console --tray
```

3. Instala el inicio automático: `python -m printbridge.main --install-autostart`.
4. Empaquetado Windows con PyInstaller + NSIS: ver `desktop/build/nsis/printbridge.nsi` y `desktop/README.md`.

El agente usa TLS (`wss://`) en producción, reporta telemetría cada 30 s y guarda trabajos en `local_queue.db` si se cae la red.

---

## 9. LogRocket (opcional)

Añade a `.env` y reinicia:

```env
NEXT_PUBLIC_LOGROCKET_APP_ID="tu-empresa/printflow-web"
NEXT_PUBLIC_LOGROCKET_RELEASE="v1.0.0"
```

Sin App ID no se descarga ningún script. El saneamiento de secretos está en `src/lib/logrocket.ts`.

---

## 10. Verificación post-despliegue

```bash
APP_URL=https://tudominio.com ./scripts/smoke-test.sh
curl -s https://tudominio.com/api/health | jq
pm2 logs printflow --lines 100
```

Chequea también:

- [ ] `/checkout/<id>` muestra progreso en vivo (`live` en verde).
- [ ] El panel Admin conecta Socket.io (`/admin`) y ve estaciones online.
- [ ] Un pago de prueba crea un `PrintJob` y el agente reporta `COMPLETED`.
- [ ] Los webhooks devuelven 200 y no duplican pagos (idempotencia).
- [ ] `DEMO_PAYMENTS=false` en producción.

---

## 11. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `502` en Nginx | PM2 caído | `pm2 logs printflow`; `pm2 restart printflow` |
| WebSocket no conecta | Falta `Upgrade` en Nginx | Revisa el bloque `map $http_upgrade` y `proxy_set_header Connection` |
| `SIGBUS` al compilar | Binario SWC truncado | `rm -rf node_modules && npm ci` en un disco estable |
| `P1012` Prisma | `DATABASE_URL` ausente | Verifica `.env` y `npx prisma validate` |
| Orden no avanza | Estación desconectada | `GET /api/employee/stations` → `last_seen`; revisa token y reloj del sistema |
| Pago confirmado pero no imprime | Webhook rechazado | Revisa firma, `APP_URL` y logs de `/api/webhooks/*` |
| Build lento / OOM | Poca RAM | `experimental.cpus: 1` ya configurado; usa `NODE_OPTIONS=--max-old-space-size=1536` |
