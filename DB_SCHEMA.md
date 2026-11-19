# DB_SCHEMA.md — PrintFlow ERP & PrintBridge Desktop

## 1. Esquema de Base de Datos (Prisma ORM)

El esquema fuente de verdad es `prisma/schema.prisma`. A continuación se documentan las entidades lógicas (equivalentes a las tablas SQL generadas por Prisma). Soporte: **SQLite por defecto** (`file:./dev.db`) y cambio a PostgreSQL/MySQL/SQL Server mediante `DATABASE_URL` sin reescribir código.

### 1.1 Tabla: users
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CLIENT', 'EMPLOYEE', 'ADMIN')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.2 Tabla: printers
```sql
CREATE TABLE printers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('LOCAL', 'NETWORK', 'SHARED')),
  ip TEXT,
  port INTEGER,
  protocol TEXT CHECK (protocol IN ('IPP', 'CUPS', 'RAW', 'SMB')),
  capabilities JSON NOT NULL, -- {color, duplex, trays, paper_sizes}
  status TEXT DEFAULT 'OFFLINE', -- OFFLINE, ONLINE, PAUSED, ERROR
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.3 Tabla: stations
```sql
CREATE TABLE stations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL, -- JWT para autenticación del agente
  computer_name TEXT NOT NULL,
  os TEXT NOT NULL CHECK (os IN ('WINDOWS', 'LINUX', 'MACOS')),
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.4 Tabla: orders
```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  pages INTEGER NOT NULL,
  copies INTEGER DEFAULT 1,
  color BOOLEAN DEFAULT FALSE,
  duplex BOOLEAN DEFAULT FALSE,
  paper_size TEXT DEFAULT 'A4',
  total_price DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) DEFAULT 0,
  free_pages INTEGER DEFAULT 0,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  payment_provider TEXT CHECK (payment_provider IN ('STRIPE', 'PAYPAL')),
  payment_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.5 Tabla: discount_rules
```sql
CREATE TABLE discount_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PERCENTAGE', 'FIXED', 'FREE_PAGES')),
  threshold INTEGER, -- mínimo de páginas para aplicar
  value DECIMAL(10,2) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.6 Tabla: payments
```sql
CREATE TABLE payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL CHECK (provider IN ('STRIPE', 'PAYPAL')),
  provider_id TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL,
  webhook_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.7 Tabla: printer_status_log
```sql
CREATE TABLE printer_status_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  status TEXT NOT NULL,
  message TEXT,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 2. Índices
- `idx_users_email` en `users(email)`
- `idx_orders_user_id` en `orders(user_id)`
- `idx_orders_status` en `orders(status)`
- `idx_payments_order_id` en `payments(order_id)`
- `idx_stations_token` en `stations(token)`