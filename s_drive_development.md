# ESPECIFICACIÓN DEL SISTEMA: PLATAFORMA WEB + BACKEND + PROGRAMA DE ESCRITORIO DE IMPRESIÓN ("PrintFlow ERP & PrintBridge Desktop")

Actúa como un Arquitecto de Software Senior, Ingeniero de Sistemas de Escritorio/Hardware y Diseñador UI/UX de sistemas ERP. Antes de escribir código de producción, genera primero los documentos de especificación (`SPEC.md`, `ARCHITECTURE.md`, `DB_SCHEMA.md`, `DESKTOP_AGENT_SPEC.md` y `API_CONTRACT.md`) y luego implementa todo el ecosistema de forma modular, limpia y segura.

## 1. Arquitectura General del Ecosistema (3 Capas Integradas)
Construye una solución completa dividida en tres componentes sincronizados:
1. **Aplicación Web (Frontend Comercial + Portal Cliente + Panel Admin estilo Odoo):**
   - Interfaz web moderna donde los clientes suben documentos, cotizan, pagan (Stripe / PayPal), ven su orden y pago en el checkout y siguen imprimiendo; y donde Empleados y Administradores gestionan todo el negocio.
2. **Backend & API Central (Motor de Negocio y Orquestación):**
   - Gestiona usuarios/roles, cotizaciones, reglas de descuentos/impresiones gratis, webhooks de pago (Stripe/PayPal), almacenamiento temporal seguro de archivos y el **broker de comunicación en tiempo real (WebSockets + fallback REST)** hacia las computadoras conectadas.
   - **Base de Datos Agnóstica (SQLite por defecto):** Diseñada con ORM portable (Prisma o Drizzle ORM) y patrón repositorio para soportar **SQLite por defecto** (`file:./dev.db`) para arranque inmediato, y permitir cambiar sin reescribir código a **PostgreSQL, MySQL/MariaDB o SQL Server** mediante configuración.
3. **Programa Nativo de Escritorio (`PrintBridge Desktop` — El Núcleo Tecnológico):**
   - Una aplicación de escritorio instalable y ejecutable directamente en las computadoras de las estaciones de impresión (Windows / macOS / Linux, construida por ejemplo en **C# WPF/.NET** o **Tauri / Electron + módulo nativo de spooler**), con icono en la bandeja del sistema (*System Tray*), inicio automático con el sistema operativo y una **consola visual local** para el operador.
   - **Poderes directos sobre hardware y red:**
     - **Autodescubrimiento de Impresoras:** Detecta automáticamente todas las impresoras instaladas en la computadora (USB/locales), impresoras compartidas por SMB/Windows y dispositivos en la red local (LAN mediante IPP, CUPS, WSD, mDNS/Bonjour y puerto TCP RAW 9100).
     - **Telemetría y Control en Tiempo Real:** Lee el estado real del *spooler* del sistema operativo (`Lista`, `Imprimiendo`, `Sin papel`, `Atasco`, `Tóner bajo`, `Desconectada`, `Pausada`), permite pausar/reanudar colas, cancelar trabajos atascados, imprimir páginas de prueba y mapear qué impresoras físicas se exponen hacia la plataforma web.
     - **Ejecución Directa y Silenciosa de Trabajos:** Recibe trabajos pagados y autorizados desde el backend por túnel WebSocket seguro (TLS + Token de Estación), descarga el documento cifrado, aplica los parámetros exactos (copias, rango de páginas, color/B&N, dúplex, tamaño de papel, bandeja) directamente al motor nativo de impresión del SO sin diálogos emergentes, reporta el progreso página por página al backend/web y elimina el archivo temporal tras confirmar la impresión.
     - **Modo Contingencia / Cola Local:** Si se corta momentáneamente el internet mientras un trabajo ya fue descargado y pagado, la app de escritorio lo completa localmente y sincroniza el estado apenas recupere conexión.

## 2. Identidad Visual y Paleta de Colores Adaptada
Diseña tanto la Web como la Consola del Programa de Escritorio con una identidad visual unificada, de alto contraste (WCAG 2.1) y tipografía **Roboto**:
- **Color Primario (Confianza y Precisión Técnica):** Azul Cobalto Profundo (`#1E40AF` / `#2563EB`) para acciones principales, navegación ERP y controles activos.
- **Color Secundario / Acento (Velocidad, Tecnología y Promociones):** Turquesa / Cian Editorial (`#0891B2` / `#06B6D4`) para estados de conexión en vivo de las computadoras/impresoras, badges de descuentos e impresiones gratis.
- **Neutros y Superficies (Estilo Odoo limpio):** Fondos claros (`#F8FAFC` / `#F1F5F9`), tarjetas blancas (`#FFFFFF`) con bordes sutiles (`#E2E8F0`), textos de alta legibilidad (`#0F172A` y `#475569`), y modo oscuro opcional en la app de escritorio para estaciones de trabajo.
- **Semánticos:** Éxito (`#15803D` / `#16A34A` para pagado/impreso/online), Advertencia (`#B45309` / `#D97706` para pendiente/cola/tóner bajo), Error (`#B91C1C` / `#DC2626` para fallos o impresora offline).

## 3. Cotización, Descuentos, Impresiones Gratis y Checkout + "Seguir Imprimiendo"
1. **Cotización Instantánea Conectada a Capacidades Reales:**
   - Calcula precios según páginas detectadas, copias, color vs. B&N, tamaño de papel, simple cara / dúplex y disponibilidad real de las impresoras conectadas desde las computadoras registradas.
2. **Descuentos e Impresiones Gratis por Cantidad:**
   - Reglas configurables desde el Admin Panel (por ejemplo: descuentos escalonados por volumen de páginas y acumulación de impresiones/páginas gratis al superar ciertos umbrales).
   - Visualización transparente en el cotizador y en el checkout de cuánto ahorra el cliente y cuántas impresiones gratis ganó o usó.
3. **Pagos con Stripe y PayPal:**
   - Integración completa con **Stripe** (PaymentIntents / Checkout + Webhooks) y **PayPal** (Orders API + Webhooks) con validación criptográfica e idempotencia para que **ningún trabajo se envíe a la computadora/impresora sin confirmación oficial de pago**.
4. **Checkout Page con Orden, Pago y Bloque "Seguir Imprimiendo":**
   - Muestra el resumen completo de la orden, desglose de descuentos/impresiones gratis, recibo/ID de transacción de Stripe o PayPal y progreso en vivo enviado desde el programa de escritorio (`Recibido en estación PC-01 -> Imprimiendo -> Completado`).
   - Incluye botones prominentes para **seguir imprimiendo** (subir nuevos archivos en la misma sesión, repetir la orden, agregar más copias o enviar a otra impresora sin fricción).

## 4. Roles, Front Page y Admin Panel Nivel Odoo
1. **Front Page Comercial:**
   - Landing page moderna con cotizador rápido interactivo, explicación clara de beneficios por volumen (descuentos + impresiones gratis), seguridad de pago con Stripe y PayPal y acceso rápido para clientes.
2. **Roles y Permisos (RBAC):**
   - **Cliente:** Sube documentos, cotiza, paga, rastrea en vivo su impresión, descarga comprobantes, gestiona sus impresiones gratis acumuladas y sigue imprimiendo.
   - **Empleado:** Opera tanto en la web como en el programa de escritorio; supervisa estaciones PC conectadas, colas locales y de red, reasigna impresoras si una se queda sin papel y libera impresiones en mostrador.
   - **Administrador (Panel estilo Odoo):**
     - Módulos completos: **Estaciones y Computadoras Conectadas (PrintBridge)**, **Impresoras Locales y de Red**, **Órdenes y Cola Global**, **Reglas de Descuentos e Impresiones Gratis**, **Tarifario**, **Pagos Stripe/PayPal**, **Usuarios/Roles**, **Configuración de Base de Datos (SQLite / PostgreSQL / MySQL)** y **Reportes/KPIs**.

## 5. Entregables Esperados
1. Genera primero la documentación técnica: `SPEC.md`, `ARCHITECTURE.md`, `DB_SCHEMA.md`, `DESKTOP_AGENT_SPEC.md` (detallando el protocolo WebSocket, manejo de spooler local/red, emparejamiento por código/token de cada computadora y recuperación ante fallos) y `API_CONTRACT.md`.
2. Implementa el código estructurado del **Backend**, el **Frontend Web** y el **Programa de Escritorio (`PrintBridge Desktop`)**, junto con `.env.example` (SQLite por defecto), scripts de arranque y datos de prueba (*seed*).