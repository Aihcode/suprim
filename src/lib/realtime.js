/**
 * Puente de tiempo real entre `server.js` (CommonJS) y las API routes (TS/ESM).
 * Módulo CommonJS intencional: es el único que puede ser `require`do desde el
 * custom server y `import`ado desde TypeScript. Tipos en realtime.d.ts.
 */
// Se guarda en globalThis (no en una variable del módulo) porque Next.js
// empaqueta las API routes por separado: el módulo puede evaluarse dos veces
// dentro del mismo proceso Node (custom server + bundle de API routes).
const GLOBAL_KEY = '__printflow_socket_io__';

function setIO(instance) {
  globalThis[GLOBAL_KEY] = instance || null;
}

function getIO() {
  return globalThis[GLOBAL_KEY] || null;
}

function emitToRoom(room, event, payload) {
  const io = getIO();
  if (!io || !room) return false;
  try {
    io.to(room).emit(event, payload);
    return true;
  } catch (error) {
    console.warn('[realtime] emitToRoom falló:', error && error.message);
    return false;
  }
}

function emitToStation(stationId, event, payload) {
  if (!stationId) return false;
  return emitToRoom('station:' + stationId, event, payload);
}

function getSocketServer() {
  return getIO();
}

/** Emite en el namespace raíz y en los paneles /admin y /client. */
function emitToAll(event, payload) {
  const io = getIO();
  if (!io) return false;
  try {
    io.emit(event, payload);
    io.of('/admin').emit(event, payload);
    io.of('/client').emit(event, payload);
    return true;
  } catch (error) {
    console.warn('[realtime] emitToAll falló:', error && error.message);
    return false;
  }
}

module.exports = {
  setIO,
  getIO,
  getSocketServer,
  emitToRoom,
  emitToStation,
  emitToAll,
};
