/**
 * Custom server Next.js + Socket.io (CommonJS).
 *   npm run dev   -> node server.js
 * Namespaces: /station (agente PrintBridge), /admin y /client (paneles web).
 * El módulo `src/lib/realtime.js` comparte el objeto io con las API routes.
 */
require('dotenv').config();

const http = require('http');
const next = require('next');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const realtime = require('./src/lib/realtime');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-station-secret';
const ORDER_STATUS = {
  RECEIVED: 'PROCESSING',
  DOWNLOADING: 'PROCESSING',
  PRINTING: 'PROCESSING',
  LOCAL_QUEUE: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

function decodeStationToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return decoded.stationId || decoded.station_id || decoded.sub || null;
  } catch (error) {
    console.warn('[ws] token de estación inválido:', error.message);
    return null;
  }
}

const stationSockets = new Map(); // stationId -> Set<socket.id>
const jobUpdateChains = new Map(); // jobId -> Promise (serializa progreso por trabajo)

/** Los handlers async pueden escribir fuera de orden; encadenarlos por job_id
 *  evita que un PRINTING tardío sobrescriba un COMPLETED. */
function withJobLock(jobId, task) {
  const previous = jobUpdateChains.get(jobId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  jobUpdateChains.set(jobId, current);
  void current.finally(() => {
    if (jobUpdateChains.get(jobId) === current) jobUpdateChains.delete(jobId);
  });
  return current;
}

function registerStationSocket(stationId, socketId) {
  if (!stationSockets.has(stationId)) stationSockets.set(stationId, new Set());
  stationSockets.get(stationId).add(socketId);
}

function unregisterStationSocket(stationId, socketId) {
  const sockets = stationSockets.get(stationId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) stationSockets.delete(stationId);
}

async function stationsStatusPayload() {
  const stations = await prisma.station.findMany({
    include: { printers: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return {
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      computer_name: station.computerName,
      location: station.computerName,
      status: (stationSockets.get(station.id)?.size || 0) > 0 ? 'ONLINE' : 'OFFLINE',
      active: station.active,
      last_seen: station.lastSeen ? station.lastSeen.toISOString() : null,
      printers: station.printers.length,
    })),
  };
}

async function broadcastStationsStatus(io) {
  try {
    io.of('/admin').emit('stations.status', await stationsStatusPayload());
  } catch (error) {
    console.warn('[ws] no se pudo difundir el estado de estaciones:', error.message);
  }
}

function progressPayload(socket, data) {
  return {
    type: 'order.progress',
    job_id: data.jobId,
    order_id: data.orderId,
    station_id: socket.data.stationId || data.stationId || null,
    status: data.status,
    order_status: data.orderStatus || null,
    page_current: data.pageCurrent ?? 0,
    page_total: data.pageTotal ?? 0,
    message: data.message || null,
    timestamp: new Date().toISOString(),
  };
}

async function handleJobProgress(socket, payload) {
  const stationId = socket.data.stationId;
  if (!stationId) return;

  const jobId = payload.job_id || payload.jobId;
  if (!jobId) return;

  const job = await prisma.printJob.findFirst({
    where: { id: jobId, OR: [{ stationId }, { stationId: null }] },
    include: { order: true },
  });
  if (!job) {
    socket.emit('agent.error', { code: 'JOB_NOT_FOUND', job_id: jobId });
    return;
  }

  const status = String(payload.status || 'PRINTING').toUpperCase();
  const pageCurrent = Number(payload.page_current ?? payload.pageCurrent ?? job.pageCurrent);
  const pageTotal = Number(payload.page_total ?? payload.pageTotal ?? job.pageTotal);
  const message = payload.message ?? job.message;

  await prisma.printJob.update({
    where: { id: job.id },
    data: { status, pageCurrent, pageTotal, message, attempts: { increment: 0 } },
  });
  await prisma.jobProgress.create({
    data: { jobId: job.id, status, pageCurrent, pageTotal, message },
  });

  const orderStatus = ORDER_STATUS[status];
  let currentOrder = job.order;
  if (orderStatus && currentOrder.status !== orderStatus && currentOrder.status !== 'CANCELLED') {
    currentOrder = await prisma.order.update({
      where: { id: currentOrder.id },
      data: { status: orderStatus },
    });
  }

  const broadcast = progressPayload(socket, {
    jobId: job.id,
    orderId: currentOrder.id,
    status,
    orderStatus: currentOrder.status,
    pageCurrent,
    pageTotal,
    message,
  });
  // El frontend se conecta al namespace raíz; los paneles usan /admin y /client.
  socket.nsp.server.emit('order.progress', broadcast);
  socket.nsp.server.emit('job.progress', broadcast);
  socket.nsp.server.of('/admin').emit('order.progress', broadcast);
  socket.nsp.server.of('/client').emit('order.progress', broadcast);
  socket.nsp.server.of('/admin').to(`order:${currentOrder.id}`).emit('order.progress', broadcast);
  socket.nsp.server.of('/client').to(`order:${currentOrder.id}`).emit('order.progress', broadcast);
  socket.nsp.server.of('/client').to(`user:${currentOrder.userId}`).emit('order.progress', broadcast);
}

async function handlePrinterStatus(socket, payload) {
  const stationId = socket.data.stationId;
  if (!stationId) return;
  const printers = Array.isArray(payload.printers) ? payload.printers : [payload];
  const updates = [];

  for (const item of printers) {
    const printerId = item.printer_id || item.printerId || item.id;
    if (!printerId) continue;
    const data = {
      status: String(item.status || 'ONLINE').toUpperCase(),
      message: item.message || null,
      timestamp: item.timestamp || new Date().toISOString(),
      printer_id: printerId,
      station_id: stationId,
    };

    let printer = await prisma.printer.findUnique({ where: { id: printerId } });
    if (!printer) {
      printer = await prisma.printer.create({
        data: {
          id: printerId,
          name: item.name || 'Impresora',
          type: String(item.type || 'LOCAL').toUpperCase(),
          ip: item.ip || null,
          port: item.port ? Number(item.port) : null,
          protocol: item.protocol || null,
          capabilities: JSON.stringify(item.capabilities || {}),
          status: data.status,
          stationId,
        },
      });
    } else {
      printer = await prisma.printer.update({
        where: { id: printerId },
        data: {
          status: data.status,
          ...(item.name ? { name: item.name } : {}),
          ...(item.capabilities ? { capabilities: JSON.stringify(item.capabilities) } : {}),
        },
      });
    }

    await prisma.printerStatusLog.create({
      data: { printerId: printer.id, status: data.status, message: data.message },
    });
    updates.push({ ...data, name: printer.name });
  }

  if (updates.length) {
    socket.nsp.server.of('/admin').emit('printer.status', { printers: updates });
    socket.nsp.server.of('/client').emit('printer.status', { printers: updates });
    socket.nsp.server.emit('printer.status', { printers: updates });
    await broadcastStationsStatus(socket.nsp.server);
  }
}

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => handle(req, res));
    const io = new Server(server, {
      path: process.env.SOCKET_IO_PATH || '/socket.io',
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });
    realtime.setIO(io);

    // ----- Namespace raíz (paneles web / hook de progreso del frontend) -----
    io.on('connection', (socket) => {
      const subscribe = (payload = {}) => {
        const orderId = payload.order_id || payload.orderId;
        const userId = payload.user_id || payload.userId;
        if (orderId) socket.join(`order:${orderId}`);
        if (userId) socket.join(`user:${userId}`);
      };
      socket.on('subscribe', subscribe);
      socket.on('order.subscribe', subscribe);
      socket.on('client.subscribe', subscribe);
    });

    // ----- Namespace /station (agente PrintBridge) -------------------------
    const stationNs = io.of('/station');
    stationNs.on('connection', (socket) => {
      console.log('[ws:station] conexión entrante', socket.id);

      socket.on('station.auth', async (payload = {}) => {
        try {
          const stationId = payload.station_id || payload.stationId;
          const token = payload.token;
          if (!stationId || !token) throw new Error('missing_credentials');
          const tokenStationId = decodeStationToken(token);
          if (!tokenStationId || tokenStationId !== stationId) throw new Error('invalid_token');

          const station = await prisma.station.findUnique({ where: { id: stationId } });
          if (!station || !station.active) throw new Error('station_inactive');

          await prisma.station.update({
            where: { id: stationId },
            data: {
              lastSeen: new Date(),
              ...(station.token !== token ? { token } : {}),
              ...(payload.computer_name ? { computerName: payload.computer_name } : {}),
              ...(payload.os ? { os: String(payload.os).toUpperCase() } : {}),
            },
          });

          socket.data.stationId = stationId;
          socket.data.authenticated = true;
          socket.join(`station:${stationId}`);
          registerStationSocket(stationId, socket.id);
          socket.emit('station.auth.ok', { type: 'station.auth.ok', station_id: stationId, stationId });
          await broadcastStationsStatus(io);
          console.log('[ws:station] autenticada', stationId);

          // Los trabajos pendientes NO se reenvían como evento incompleto:
          // el agente los recupera con GET /api/station/jobs/pending, que es
          // la única fuente con file_url, claves y parámetros completos.
        } catch (error) {
          console.warn('[ws:station] auth fallida:', error.message);
          socket.emit('station.auth.fail', {
            type: 'station.auth.fail',
            reason: 'invalid_token',
            message: error.message,
          });
        }
      });

      socket.on('station.heartbeat', async (payload = {}) => {
        if (!socket.data.stationId) return;
        try {
          await prisma.station.update({
            where: { id: socket.data.stationId },
            data: { lastSeen: new Date() },
          });
          socket.emit('station.heartbeat.ack', { timestamp: payload.timestamp || new Date().toISOString() });
          await broadcastStationsStatus(io);
        } catch (error) {
          console.warn('[ws:station] heartbeat error:', error.message);
        }
      });

      socket.on('job.progress', (payload = {}) => {
        const jobId = payload.job_id || payload.jobId || socket.id;
        void withJobLock(jobId, () => handleJobProgress(socket, payload)).catch((error) => {
          console.error('[ws:station] job.progress error:', error);
          socket.emit('agent.error', { code: 'PROGRESS_ERROR', message: error.message });
        });
      });

      socket.on('printer.status', async (payload = {}) => {
        try {
          await handlePrinterStatus(socket, payload);
        } catch (error) {
          console.error('[ws:station] printer.status error:', error);
        }
      });

      socket.on('agent.error', (payload) => {
        console.warn('[ws:station] agent.error', payload);
        io.of('/admin').emit('agent.error', payload);
      });

      socket.on('disconnect', (reason) => {
        if (!socket.data.stationId) return;
        unregisterStationSocket(socket.data.stationId, socket.id);
        console.log('[ws:station] desconectada', socket.data.stationId, reason);
        void broadcastStationsStatus(io);
      });
    });

    // ----- Namespace /admin -------------------------------------------------
    const adminNs = io.of('/admin');
    adminNs.on('connection', (socket) => {
      socket.join('admin:all');
      console.log('[ws:admin] conectado', socket.id);
      void stationsStatusPayload()
        .then((payload) => socket.emit('stations.status', payload))
        .catch((error) => console.warn('[ws:admin] estado inicial falló:', error.message));

      socket.on('telemetry.request', (payload = {}) => {
        const stationId = payload.station_id || payload.stationId;
        if (stationId) {
          realtime.emitToStation(stationId, 'telemetry.request', {
            type: 'telemetry.request',
            station_id: stationId,
          });
        } else {
          stationNs.emit('telemetry.request', { type: 'telemetry.request', station_id: null });
        }
      });

      socket.on('print.control', (payload = {}) => {
        const stationId = payload.station_id || payload.stationId;
        if (stationId) realtime.emitToStation(stationId, 'print.control', payload);
      });
    });

    // ----- Namespace /client ------------------------------------------------
    const clientNs = io.of('/client');
    clientNs.on('connection', (socket) => {
      const auth = socket.handshake.auth || {};
      if (auth.order_id || auth.orderId) socket.join(`order:${auth.order_id || auth.orderId}`);
      if (auth.user_id || auth.userId) socket.join(`user:${auth.user_id || auth.userId}`);
      socket.join('client:all');
      socket.on('client.subscribe', (payload = {}) => {
        if (payload.order_id) socket.join(`order:${payload.order_id}`);
        if (payload.user_id) socket.join(`user:${payload.user_id}`);
      });
    });

    server.listen(port, hostname, () => {
      console.log(`> PrintFlow listo en http://${hostname}:${port} (${dev ? 'dev' : 'prod'})`);
      console.log(`> Socket.io path: ${process.env.SOCKET_IO_PATH || '/socket.io'}`);
    });

    let shuttingDown = false;
    function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[server] ${signal} recibido; cerrando...`);
      const timer = setTimeout(() => process.exit(0), 8000);
      timer.unref();
      io.close(async () => {
        await prisma.$disconnect();
        server.close(() => {
          clearTimeout(timer);
          process.exit(0);
        });
      });
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((error) => {
    console.error('No se pudo iniciar el servidor:', error);
    process.exit(1);
  });
