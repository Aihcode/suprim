# API_CONTRACT.md — PrintFlow ERP & PrintBridge Desktop

Contrato de API de la plataforma PrintFlow ERP. Backend implementado en Next.js (App Router) con Prisma ORM, NextAuth.js, Socket.io (WebSockets) y webhooks de Stripe/PayPal.

## 1. Base y Autenticación

- **Base URL:** `https://<host>` (desarrollo: `http://localhost:3000`)
- **Versión:** No versionada por path; los cambios rompedores se comunican por changelog.
- **Autenticación de usuario:** NextAuth.js (JWT en cookie `next-auth.session-token`). Endpoints protegidos requieren sesión válida.
- **Autenticación de estación (PrintBridge):** Header `Authorization: Bearer <station_token>` en REST; mensaje `station.auth` al abrir WebSocket.
- **Content-Type:** `application/json` salvo webhooks (raw body para verificación de firma).

### Códigos de respuesta

| Código | Significado |
|--------|-------------|
| 200 | OK |
| 201 | Creado |
| 204 | Sin contenido |
| 400 | Solicitud inválida (validación) |
| 401 | No autenticado |
| 403 | Sin permisos (RBAC) |
| 404 | No encontrado |
| 409 | Conflicto (idempotencia, duplicado) |
| 429 | Rate limit excedido |
| 500 | Error interno |

### Formato de error

```json
{
  "error": "código_de_error_legible",
  "message": "Descripción legible para el desarrollador",
  "details": {}
}
```

## 2. Roles y Permisos (RBAC)

- `CLIENT`: sube documentos, cotiza, paga, rastrea su impresión, gestiona impresiones gratis.
- `EMPLOYEE`: gestiona estaciones, colas, reasigna impresoras, libera impresiones en mostrador.
- `ADMIN`: panel completo (usuarios, reglas de descuento, tarifario, pagos, reportes, configuración DB).

Middleware RBAC por ruta: `GET /api/admin/*` → `ADMIN`; `GET /api/employee/*` → `EMPLOYEE` o `ADMIN`; `GET /api/client/*` → autenticado.

## 3. Endpoints Públicos

### 3.1 Autenticación (NextAuth)

- `POST /api/auth/signin` — Iniciar sesión (credenciales / OAuth).
- `POST /api/auth/signout` — Cerrar sesión.
- `POST /api/auth/register` — Registro de cliente (email, password, name).
- `GET /api/auth/session` — Sesión actual del usuario.

### 3.2 Cotizador (público + autenticado)

- `POST /api/quote/calculate`
  - Body: `{ file_pages: number, copies: number, color: boolean, duplex: boolean, paper_size: string, user_id?: string }`
  - Respuesta: `{ base_price, discount, free_pages, total_price, breakdown }`
  - Aplica reglas de descuento e impresiones gratis del usuario autenticado si se pasa `user_id`.

## 4. Endpoints de Cliente

### 4.1 Órdenes

- `GET /api/client/orders` — Listar órdenes del usuario autenticado.
  - Query: `status?`, `page?`, `limit?`
  - Respuesta: `{ orders: [...], total, page, limit }`
- `GET /api/client/orders/:id` — Detalle de una orden (incluye pagos, progreso).
- `POST /api/client/orders` — Crear orden (subida de archivo + parámetros).
  - Body multipart: `file`, `copies`, `color`, `duplex`, `paper_size`
  - Respuesta: `{ order, payment_url }`
- `POST /api/client/orders/:id/pay` — Iniciar pago (Stripe Checkout / PayPal Order).
  - Body: `{ provider: "STRIPE" | "PAYPAL" }`
  - Respuesta: `{ checkout_url }`

### 4.2 Seguimiento en vivo

- `GET /api/client/orders/:id/progress` — Progreso actual de la orden (viene del agente de escritorio).

### 4.3 Impresiones gratis

- `GET /api/client/free-pages` — Saldo e historial de impresiones gratis del usuario.

## 5. Endpoints de Empleado

### 5.1 Estaciones (PrintBridge)

- `GET /api/employee/stations` — Listar estaciones conectadas con último `last_seen` y token.
- `GET /api/employee/stations/:id` — Detalle de estación.
- `POST /api/employee/stations` — Registrar estación (nombre, computer_name, os, token generado).
- `PATCH /api/employee/stations/:id` — Editar nombre / activar-desactivar.
- `DELETE /api/employee/stations/:id` — Eliminar estación.

### 5.2 Impresoras

- `GET /api/employee/printers` — Listar impresoras (locales, de red, compartidas) con estado.
- `POST /api/employee/printers` — Registrar impresora descubierta por el agente.
- `PATCH /api/employee/printers/:id` — Actualizar estado / capacidades / mapeo a estación.
- `POST /api/employee/printers/:id/test-page` — Enviar página de prueba.

### 5.3 Cola global de órdenes

- `GET /api/employee/orders` — Todas las órdenes con filtros (`status`, `station_id`, `printer_id`).
- `PATCH /api/employee/orders/:id` — Cambiar estado, reasignar impresora/estación.
- `POST /api/employee/orders/:id/release` — Liberar impresión en mostrador.

## 6. Endpoints de Administración (Odoo-style)

### 6.1 Usuarios y Roles

- `GET /api/admin/users` — Listar usuarios con rol.
- `POST /api/admin/users` — Crear usuario.
- `PATCH /api/admin/users/:id` — Cambiar rol / estado.
- `DELETE /api/admin/users/:id` — Eliminar usuario.

### 6.2 Reglas de Descuentos e Impresiones Gratis

- `GET /api/admin/discount-rules` — Listar reglas activas.
- `POST /api/admin/discount-rules` — Crear regla (`type: PERCENTAGE | FIXED | FREE_PAGES`, `threshold`, `value`).
- `PATCH /api/admin/discount-rules/:id` — Editar regla.
- `DELETE /api/admin/discount-rules/:id` — Eliminar regla.

### 6.3 Tarifario

- `GET /api/admin/tariffs` — Listar precios por página (color/B&N, tamaño, dúplex).
- `POST /api/admin/tariffs` — Crear/actualizar tarifa.

### 6.4 Pagos

- `GET /api/admin/payments` — Listar pagos con filtro por proveedor y estado.
- `GET /api/admin/payments/:id` — Detalle de pago.

### 6.5 Configuración de Base de Datos

- `GET /api/admin/db-config` — Motor activo (SQLite/PostgreSQL/MySQL/SQL Server).
- `PATCH /api/admin/db-config` — Cambiar motor (requiere reinicio).

### 6.6 Reportes / KPIs

- `GET /api/admin/reports/summary` — Órdenes, ingresos, impresiones por período.
- `GET /api/admin/reports/printers` — Uso por impresora.

## 7. Endpoints de Estación (PrintBridge Desktop)

Requieren header `Authorization: Bearer <station_token>`.

### 7.1 Registro y Heartbeat

- `POST /api/station/auth` — Autenticar estación y devolver `station_id`.
  - Body: `{ station_id, token, computer_name, os, capabilities }`
- `POST /api/station/heartbeat` — Reportar latitud de la estación.
  - Body: `{ station_id, timestamp }`

### 7.2 Trabajos pendientes (polling fallback)

- `GET /api/station/jobs/pending` — Trabajos asignados a la estación no completados.
  - Respuesta: `{ jobs: [...] }`
- `POST /api/station/jobs/:job_id/progress` — Reportar progreso del agente.
  - Body: `{ status, page_current, page_total, message }`

### 7.3 Sincronización de modo contingencia

- `POST /api/station/jobs/sync` — Enviar estados de trabajos locales pendientes tras recuperar conexión.
  - Body: `{ jobs: [{ job_id, status, ... }] }`

### 7.4 Token

- `POST /api/station/token/refresh` — Renovar token de estación.

## 8. WebSockets (Socket.io)

Namespace: `/station`

### 8.1 Cliente → Servidor

- `station.auth` — Autenticar estación al conectar.
  - Payload: `{ station_id, token, computer_name, os, capabilities }`
- `station.heartbeat` — Heartbeat periódico.
- `job.progress` — Reportar progreso de impresión.
- `printer.status` — Reportar telemetría de impresoras.

### 8.2 Servidor → Cliente

- `station.auth.ok` / `station.auth.fail`
- `print.job` — Nuevo trabajo de impresión (descargar, imprimir, reportar).
- `print.control` — Control de cola (pause/resume/cancel/test_page).
- `telemetry.request` — Solicitud de telemetría inmediata.

### 8.3 Namespace `/admin` y `/client` (opcional, paneles web)

- Notificaciones en tiempo real de estado de órdenes e impresoras para paneles admin y cliente.

## 9. Webhooks de Pago

### 9.1 Stripe

- `POST /api/webhooks/stripe`
  - Header: `Stripe-Signature`
  - Eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`
  - Idempotencia: clave `stripe_event_id` en tabla `payments`.

### 9.2 PayPal

- `POST /api/webhooks/paypal`
  - Header: `PayPal-Transmission-Id`, `PayPal-Transmission-Time`, `PayPal-Cert-Url`, `PayPal-Auth-Algo`, `PayPal-Signature`
  - Eventos: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`
  - Idempotencia: `paypal_event_id`.

### Flujo de pago

1. Cliente crea orden (`PENDING`) y paga.
2. Webhook confirma → `payments` registrada, orden → `PAID`.
3. Backend encola trabajo y notifica al agente de escritorio (WebSocket) o via REST fallback.
4. Agente imprime y reporta progreso → orden → `COMPLETED`.

## 10. Rate Limiting

- API routes públicas: 60 req/min por IP.
- Endpoints de estación: 30 req/min por token.
- Webhooks: sin rate limit (validación criptográfica obligatoria).

## 11. Ejemplos de Respuesta

**Orden creada:**
```json
{
  "id": "ord_456",
  "user_id": "u_123",
  "file_name": "documento.pdf",
  "pages": 10,
  "copies": 2,
  "color": false,
  "duplex": true,
  "paper_size": "A4",
  "total_price": 4.50,
  "discount": 0.50,
  "free_pages": 0,
  "status": "PENDING",
  "payment_provider": null,
  "payment_id": null,
  "created_at": "2026-11-19T14:13:00Z"
}
```

**Estado de impresora (telemetría):**
```json
{
  "printer_id": "printer_789",
  "name": "HP LaserJet Pro",
  "status": "ONLINE",
  "message": "Listo",
  "timestamp": "2026-11-19T14:13:00Z"
}
```
