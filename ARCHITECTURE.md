# ARCHITECTURE.md — PrintFlow ERP & PrintBridge Desktop

## 1. Arquitectura General (3 Capas)

### Capa 1: Frontend Web (Next.js App Router)
- **Páginas Públicas:** Landing, Cotizador, Checkout, Seguir Impresión
- **Panel Admin (Odoo-style):** Módulos desmontables (Estaciones, Impresoras, Órdenes, Descuentos, Pagos, Reportes)
- **Portal Cliente:** Historial, impresiones gratis, seguimiento en vivo
- **Portal Emulado:** Gestión de estaciones y colas

### Capa 2: Backend & API (Next.js API Routes + tRPC)
- **Autenticación:** NextAuth.js (JWT, OAuth2)
- **API REST:** Rutas en `src/app/api/`
- **WebSockets:** Socket.io para telemetría en tiempo real
- **Webhooks:** Stripe/PayPal (validación criptográfica, idempotencia)
- **Base de Datos:** **Prisma ORM** (SQLite/PostgreSQL configurable)

### Capa 3: Agente de Escritorio (Python)
- **Plataformas:** Windows (pywin32 + pystray), Linux (CUPS + pystray)
- **Comunicación:** WebSocket seguro (TLS + Token de Estación)
- **Funciones:** Autodescubrimiento de impresoras, control de spooler, impresión silenciosa, modo contingencia

## 2. Flujo de Datos

### 2.1 Flujo de Pago e Impresión
1. Cliente cotiza → precio calculado con reglas de descuento
2. Redirección a checkout (Stripe/PayPal)
3. Webhook recibe confirmación → estado de orden actualizado a `PAID`
4. Backend notifica al agente de escritorio (WebSocket)
5. Agente descarga archivo cifrado → imprime → reporta progreso
6. Estado final `COMPLETED` regresado al cliente

### 2.2 Flujo de Telemetría
- Agente envía estado de impresoras cada 30s (online, sin papel, atasco, tóner bajo)
- Backend actualiza tabla `printer_status` y notifica a paneles admin en tiempo real

## 3. Seguridad
- **TLS 1.3** en WebSocket entre backend y agente
- **Token de Estación** (JWT) para autenticación de agente
- **Archivos cifrados** (AES-256) en tránsito y almacenamiento temporal
- **Idempotencia** en webhooks (stripe_signature, paypal_event_id)
- **Rate limiting** en API routes (Next.js middleware)

## 4. Configuración de Base de Datos
- **Desarrollo:** SQLite (`file:./dev.db`)
- **Producción:** PostgreSQL (DATABASE_URL)
- **Migraciones:** Drizzle Kit
- **Variables de entorno:** `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID`, etc.

## 5. Deploy
- **Frontend/Backend:** Vercel (zero-config, API Routes integradas)
- **Agente Escritorio:** Instalador NSIS (Windows) / .deb o .rpm (Linux)
- **Base de Datos:** Supabase (PostgreSQL) o propio hosting

## 6. Estructura de Archivos
```
suprim/
├── src/app/                  # Páginas y API Routes
├── src/components/           # Componentes UI
├── src/lib/                  # DB, auth, websocket, utils
├── src/models/               # TypeScript types
├── desktop/                  # Agente Python
├── prisma/                   # Schema Prisma y migraciones
├── scripts/                  # Seed data
└── docs/                     # Documentación técnica
```