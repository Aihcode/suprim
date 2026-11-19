# SPEC.md — PrintFlow ERP & PrintBridge Desktop

## 1. Visión General
Sistema integral de gestión de impresión compuesto por:
- **Plataforma Web** (Next.js + API Routes + SQLite/PostgreSQL)
- **Backend Integrado** (mismo proyecto Next.js, desplegable en Vercel)
- **Agente de Escritorio** (Python, Windows/Linux) para control directo de impresoras

## 2. Stack Tecnológico
- **Frontend:** Next.js 14 (App Router), React 18, Tailwind CSS, Radix UI
- **Backend:** Next.js API Routes (REST), Socket.io (WebSockets)
- **Base de Datos:** SQLite (desarrollo) / PostgreSQL (producción) — **Prisma ORM**
- **Pagos:** Stripe + PayPal (webhooks con idempotencia)
- **Tiempo Real:** WebSocket (Socket.io) con fallback REST
- **Escritorio:** Python 3.10+, Tkinter (UI), pystray (bandeja del sistema), CUPS (Linux), pywin32 (Windows)
- **Autenticación:** NextAuth.js (OAuth2, JWT)

## 3. Arquitectura de Módulos
```
suprim/
├── src/                    # Código Next.js
│   ├── app/                # App Router (páginas + API)
│   ├── components/         # Componentes reutilizables
│   ├── lib/                # Utilidades, DB, auth
│   ├── models/             # Tipos TypeScript
│   └── styles/             # Estilos globales
├── desktop/                # Agente Python
│   ├── printbridge/        # Código principal
│   └── resources/          # Íconos, etc.
├── docs/                   # Documentación
├── scripts/                # Seeds y utilidades
├── prisma/                 # Schema de Drizzle
├── package.json
├── pyproject.toml
└── README.md
```

## 4. Flujo de Trabajo de Impresión
1. **Cliente** sube archivo → **cotizador** calcula precio (páginas, copias, color/dúplex)
2. **Descuentos/Impresiones gratis** aplicados automáticamente
3. **Pago** (Stripe/PayPal) → webhook confirma → trabajo encolado
4. **Backend** notifica al agente de escritorio vía WebSocket
5. **Agente** descarga archivo cifrado, imprime directamente sin diálogos
6. **Progreso** regresado al cliente en tiempo real (página por página)
7. **Confirmación** → estado "Completado"

## 5. Roles y Permisos
- **Cliente:** Cotizar, pagar, seguir impresión, gestionar impresiones gratis
- **Employee:** Gestionar estaciones, colas, reasignar impresoras
- **Admin:** Panel Odoo-style (módulos completos, configuración, reportes)

## 6. Entregables
1. Documentación técnica (SPEC, ARCHITECTURE, DB_SCHEMA, DESKTOP_AGENT_SPEC, API_CONTRACT)
2. Código fuente completo (backend + frontend + agente escritorio)
3. Scripts de arranque y seed data
4. .env.example