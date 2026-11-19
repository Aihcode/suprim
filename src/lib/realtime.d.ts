/** Tipos para el módulo CommonJS `src/lib/realtime.js`. */

export interface SocketLike {
  to(room: string): { emit(event: string, payload: unknown): void };
  emit(event: string, payload: unknown): void;
  of(namespace: string): SocketLike;
}

export function setIO(io: SocketLike | null): void;
export function getIO(): SocketLike | null;
export function getSocketServer(): SocketLike | null;
export function emitToRoom(room: string, event: string, payload: unknown): boolean;
export function emitToStation(stationId: string | null | undefined, event: string, payload: unknown): boolean;
export function emitToAll(event: string, payload: unknown): boolean;
