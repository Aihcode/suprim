# Guion del video tutorial — Cómo desplegar PrintFlow ERP

**Duración sugerida:** 12–14 minutos · **Formato:** 16:9, 1080p · **Voz:** narración en español neutro.
**Documento de apoyo:** [DEPLOYMENT.md](./DEPLOYMENT.md) (todos los comandos están ahí con más detalle).

> Nota: este archivo es el guion listo para grabar con OBS/Kapwing/Canva. Incluye toldos de pantalla, narration y notas de edición. No se genera un archivo de video automáticamente.

---

## Escena 0 — Intro (0:00–0:45)

**Visual:** Pantalla de Inicio → abrir `http://localhost:3000`, hacer zoom al cotizador y al panel Admin. Logo/título animado.

**Narración:**
> "En este video vas a aprender a desplegar PrintFlow ERP: una plataforma de impresión online con cotizador, pagos seguros, seguimiento en vivo y un agente de escritorio que controla las impresoras de tus estaciones. Veremos tres cosas: el arranque local en cinco minutos, un despliegue de producción con HTTPS y WebSocket, y la conexión del agente PrintBridge. Al final tendrás un sistema funcionando de punta a punta."

**Texto en pantalla:** `PrintFlow ERP · Despliegue · 12 min`

---

## Escena 1 — Arquitectura (0:45–1:45)

**Visual:** Mostrar `ARCHITECTURE.md` y dibujar/animar tres bloques: Web → Backend → Escritorio.

**Narración:**
> "El sistema tiene tres capas. La web es Next.js 14 con Tailwind: landing, cotizador, checkout y paneles cliente, empleado y administrador. El backend vive en el mismo proyecto: API Routes, Prisma con SQLite por defecto, NextAuth y un custom server que también levanta Socket.io. Y la tercera capa es PrintBridge Desktop, un agente Python que descubre impresoras, lee el spooler, imprime sin diálogos y reporta progreso por WebSocket. Ese detalle del custom server es clave: como el WebSocket va en el mismo proceso, necesitamos un servidor Node; no un despliegue serverless puro."

**Texto en pantalla:** `Web (Next.js) · API + Socket.io (server.js) · Agente Python`

---

## Escena 2 — Requisitos y primer arranque (1:45–4:00)

**Visual:** Terminal. `node --version`, `python3 --version`, `ls`.

**Comandos en pantalla:**
```bash
cd suprim
./scripts/setup.sh
npm run dev
```

**Narración:**
> "Necesitas Node 18.17 o superior y Python 3.10 si vas a usar el agente. clonamos el repo, entramos a la carpeta y ejecutamos setup.sh. Ese script copia .env.example a .env, instala dependencias, genera el cliente de Prisma, crea la base SQLite y siembra usuarios, estaciones y tarifas de prueba. Después arrancamos con npm run dev. El script ya levanta Next.js y Socket.io juntos, en el puerto 3000."

**Visual:** Abrir `http://localhost:3000`, luego `/login` con `admin@printflow.local` / `Admin123!`, entrar al panel Admin.

**Narración:**
> "El seed crea tres cuentas: administrador, empleado y cliente; el cliente arranca con diez páginas gratis. La estación PC-01 ya existe y tiene un token JWT que veremos más adelante."

---

## Escena 3 — Configuración (.env) y base de datos (4:00–5:45)

**Visual:** Abrir `.env.example` y `.env` resaltando bloques.

**Narración:**
> "El archivo .env es el centro de configuración. Por defecto usamos SQLite en file:dot-slash-dev.db, así que no necesitas instalar nada más. Para producción cambias DATABASE_URL y el provider de Prisma con scripts/switch-db.sh; el código de negocio no se toca. También están las claves de cifrado de archivos, los secretos de NextAuth y JWT, y las credenciales opcionales de Stripe y PayPal. Si dejas DEMO_PAYMENTS en true, aparece un botón de pago de prueba; en producción debe ser false."

**Comandos en pantalla:**
```bash
cp .env.example .env
./scripts/switch-db.sh postgresql "postgresql://user:pass@host:5432/printflow?schema=public"
./scripts/smoke-test.sh
```

**Narración:**
> "El smoke test verifica que respondan las páginas públicas, health y el cotizador. Es el primer chequeo después de cualquier cambio."

---

## Escena 4 — Flujo de negocio (5:45–7:15)

**Visual:** `/quote` → subir PDF → cotizar → `/checkout/<id>` → pagar DEMO → timeline.

**Narración:**
> "Probemos el flujo completo. En el cotizador subimos un documento, elegimos copias, color y dúplex; el precio se calcula con las tarifas y reglas de descuento de la base. Al continuar se crea la orden PENDING con el archivo cifrado AES-256-GCM. En el checkout podemos pagar con Stripe, PayPal o el modo demo. Cuando el webhook confirma el pago —o la confirmación demo en desarrollo— el backend crea un PrintJob, lo emite al room de la estación y el timeline empieza a moverse: recibido, descargando, imprimiendo, completado. Ningún trabajo se envía a la impresora sin pago confirmado."

**Texto en pantalla:** `PENDING → PAID → PROCESSING → COMPLETED`

---

## Escena 5 — Producción en VPS (7:15–9:45)

**Visual:** Terminal SSH. Mostrar bloques de DEPLOYMENT.md sección 4.

**Comandos en pantalla:**
```bash
sudo apt install -y git nginx certbot python3-certbot-nginx curl
npm install -g pm2
cd /opt/printflow && git clone <repo> .
cp .env.example .env && nano .env
npm ci && npx prisma generate && npx prisma db push && npm run build
pm2 start npm --name printflow -- start && pm2 save && pm2 startup
sudo certbot --nginx -d tudominio.com
```

**Narración:**
> "Para producción recomendamos un VPS con Ubuntu. Instalamos Node, Nginx, Certbot y PM2, clonamos el proyecto, configuramos .env con secretos reales, generamos Prisma, aplicamos el esquema y compilamos. PM2 mantiene el proceso vivo y se registra en el arranque. Luego Nginx hace de reverse proxy y Certbot emite el certificado HTTPS."

**Visual:** Abrir `/etc/nginx/sites-available/printflow` y hacer zoom al bloque `map $http_upgrade`.

**Narración:**
> "Esta parte es la que más se olvida: el proxy debe reenviar los headers Upgrade y Connection para que Socket.io funcione, y conviene subir client_max_body_size a 25 megabytes porque el límite de archivo es 20. Después validamos con nginx -t, recargamos y comprobamos /api/health por HTTPS."

**Texto en pantalla:** `Upgrade + Connection + client_max_body_size 25M + wss://`

---

## Escena 6 — Webhooks y LogRocket (9:45–11:00)

**Visual:** Dashboard de Stripe → Webhooks → endpoint. Luego `.env`.

**Narración:**
> "En Stripe añadimos el endpoint https://tudominio.com/api/webhooks/stripe con los eventos checkout.session.completed y payment_intent.succeeded, y copiamos el signing secret a STRIPE_WEBHOOK_SECRET. En PayPal hacemos lo propio con PAYMENT.CAPTURE.COMPLETED. El backend valida firmas y evita duplicados con una tabla de idempotencia. Opcionalmente, si tienes LogRocket, basta con poner NEXT_PUBLIC_LOGROCKET_APP_ID: se cargará el SDK, se identificará al usuario y se capturarán errores, con contraseñas y tokens saneados."

**Comandos en pantalla:**
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```

---

## Escena 7 — Agente de escritorio (11:00–12:30)

**Visual:** Panel Admin → Estaciones → copiar token. Terminal en la PC de impresión.

**Comandos en pantalla:**
```bash
cd desktop
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m printbridge.main --console --tray
python -m printbridge.main --install-autostart
```

**Narración:**
> "Cada estación se empareja con un ID y un token que se generan en el panel Admin. En la PC de impresión instalamos los requisitos de Python, pegamos el token en desktop/.env y arrancamos el agente con consola e icono de bandeja. El agente descubre impresoras locales y de red, reporta telemetría cada treinta segundos e imprime los trabajos pagados. Si se cae internet, guarda el trabajo en una cola local SQLite y sincroniza cuando vuelve la conexión. Para producción empaquetamos con PyInstaller y el instalador NSIS incluido."

**Visual:** Consola Tkinter mostrando impresoras online, trabajo en progreso y barra verde "Completado".

---

## Escena 8 — Cierre y checklist (12:30–13:30)

**Visual:** Checklist animado + URL final.

**Narración:**
> "Resumen final: arranque local con setup.sh, producción con PM2 y Nginx con WebSocket, secretos y DEMO_PAYMENTS falso, webhooks verificados, agente emparejado por token y LogRocket opcional. Con esto tu imprenta online está lista para recibir pedidos y enviarlos a imprimir en tiempo real. Los comandos y las notas de troubleshooting están en DEPLOYMENT.md. Gracias por ver el video."

**Texto en pantalla:** `DEPLOYMENT.md · /api/health · demo → producción`

---

## Apéndice — Cómo grabar este guion

1. **OBS Studio:** escena `Pantalla` + `Cámara` (opcional), captura de terminal con fuente monoespaciada 18–20 pt.
2. **Terminal:** usa un tema de alto contraste; aumenta el zoom de la terminal a 125 % para que los comandos se lean.
3. **Edición:** corta las esperas de `npm ci` y `npm run build` con un fundido y un texto "Compilando…".
4. **Accesibilidad:** añade subtítulos en español; mantén el contraste de la UI (la app ya usa paleta WCAG 2.1).
5. **Publicación:** adjunta `DEPLOYMENT.md` como recurso descargable y enlaza `README.md` en la descripción.
