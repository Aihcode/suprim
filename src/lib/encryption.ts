import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cifrado AES-256-GCM de archivos temporales.
 * La clave maestra FILE_ENCRYPTION_KEY debe ser hexadecimal de 64 caracteres
 * (32 bytes). Por cada archivo se genera un IV aleatorio de 12 bytes; el
 * authTag GCM se persiste junto a la clave/IV en `Order.fileKey` (JSON).
 * NINGÚN archivo se escribe en disco sin cifrar.
 */

const DEFAULT_KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

export interface EncryptedPayload {
  data: Buffer;
  key: string; // hex (32 bytes)
  iv: string; // hex (12 bytes)
  authTag: string; // hex (16 bytes)
}

export interface StoredFile {
  filePath: string;
  fileKey: string; // JSON { key, iv, authTag }
  checksum: string; // sha256:<hex> del contenido original
  originalSize: number;
  encryptedSize: number;
}

function masterKey(): Buffer {
  const raw = process.env.FILE_ENCRYPTION_KEY || DEFAULT_KEY_HEX;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // Fallback tolerante para entornos de desarrollo con clave inválida:
  // derivamos 32 bytes deterministas para no romper el arranque.
  console.warn('[encryption] FILE_ENCRYPTION_KEY no es hex de 64 chars: se deriva con SHA-256');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptBuffer(buffer: Buffer): EncryptedPayload {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    data,
    key: key.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptBuffer(
  data: Buffer | string,
  key: string,
  iv: string,
  authTag: string,
): Buffer {
  const payload = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return Buffer.concat([decipher.update(payload), decipher.final()]);
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Crea (si hace falta) el directorio de archivos cifrados. */
export function getUploadDir(): string {
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Cifra `buffer` y lo guarda en UPLOAD_DIR. Devuelve metadatos para la BD. */
export function saveEncryptedFile(buffer: Buffer, originalName = 'file'): StoredFile {
  const encrypted = encryptBuffer(buffer);
  const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${crypto.randomUUID()}-${safeName}.enc`;
  const filePath = path.join(getUploadDir(), fileName);
  fs.writeFileSync(filePath, encrypted.data, { mode: 0o600 });

  return {
    filePath,
    fileKey: JSON.stringify({ key: encrypted.key, iv: encrypted.iv, authTag: encrypted.authTag }),
    checksum: `sha256:${sha256(buffer)}`,
    originalSize: buffer.length,
    encryptedSize: encrypted.data.length,
  };
}

/** Lee y descifra un archivo almacenado por `saveEncryptedFile`. */
export function loadEncryptedFile(filePath: string, fileKey: string): Buffer {
  const parsed = JSON.parse(fileKey) as { key: string; iv: string; authTag: string };
  if (!parsed.key || !parsed.iv || !parsed.authTag) {
    throw new Error('fileKey inválido: faltan key/iv/authTag');
  }
  const encrypted = fs.readFileSync(filePath);
  return decryptBuffer(encrypted, parsed.key, parsed.iv, parsed.authTag);
}

/** Borra con seguridad un archivo temporal (mejor esfuerzo). */
export function removeFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ya no existe */
  }
}
