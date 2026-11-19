"""Descifrado y borrado seguro de los archivos temporales de impresión.

AES-256-GCM con ``cryptography``.  Si la librería no está instalada, el modo
DEMO utiliza un XOR derivado de SHA-256 **INSEGURO** sólo para pruebas; fuera de
DEMO la ausencia de ``cryptography`` es un error fatal para el trabajo.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from pathlib import Path

from .config import Config

log = logging.getLogger(__name__)

try:  # pragma: no cover - depende del entorno
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    HAS_AESGCM = True
except ImportError:  # pragma: no cover
    AESGCM = None  # type: ignore
    HAS_AESGCM = False

_demo_warned = False


class CryptoError(RuntimeError):
    """Fallo al descifrar o verificar un archivo."""


def is_strong_crypto_available() -> bool:
    return HAS_AESGCM


def b64decode(value: str | bytes | None) -> bytes:
    if not value:
        return b""
    if isinstance(value, bytes):
        raw = value
    else:
        raw = value.strip().encode("ascii")
    raw = raw.replace(b"-", b"+").replace(b"_", b"/")
    return base64.b64decode(raw + b"=" * (-len(raw) % 4))


def b64encode(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _warn_demo() -> None:
    global _demo_warned
    if not _demo_warned:
        log.warning(
            "DEMO/INSEGURO: 'cryptography' no está disponible; se usa XOR+SHA256 "
            "en lugar de AES-256-GCM. NO usar en producción."
        )
        _demo_warned = True


def resolve_key(config: Config | None = None, key_b64: str | None = None) -> bytes:
    """Resuelve la clave AES-256 desde el trabajo o desde ``ENCRYPTION_KEY``."""
    if key_b64:
        key = b64decode(key_b64)
        if len(key) == 32:
            return key
        log.warning("clave base64 del trabajo con longitud %d (se esperaban 32)", len(key))
    if config is not None and config.encryption_key:
        try:
            key = bytes.fromhex(config.encryption_key.strip())
            if len(key) == 32:
                return key
        except ValueError:
            log.warning("ENCRYPTION_KEY no es hexadecimal válido")
    if config is not None and config.demo_mode:
        _warn_demo()
        return b"\x00" * 32
    raise CryptoError("No hay clave AES-256 válida (key_b64 / ENCRYPTION_KEY)")


def _xor_stream(data: bytes, key: bytes, iv: bytes) -> bytes:
    out = bytearray(len(data))
    counter = 0
    for offset in range(0, len(data), 32):
        block = hashlib.sha256(key + iv + counter.to_bytes(8, "big")).digest()
        chunk = data[offset : offset + 32]
        out[offset : offset + len(chunk)] = bytes(a ^ b for a, b in zip(chunk, block))
        counter += 1
    return bytes(out)


def _write_private(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return path


def decrypt_file(
    input_path: str | Path,
    output_path: str | Path | None = None,
    *,
    key_b64: str | None = None,
    iv_b64: str | None = None,
    auth_tag_b64: str | None = None,
    config: Config | None = None,
) -> Path:
    """Descifra un archivo y devuelve la ruta del plaintext resultante.

    ``auth_tag_b64`` puede venir separado (``auth_tag_b64`` del protocolo) o
    ya concatenado al ciphertext (formato AESGCM de ``cryptography``).
    """
    src = Path(input_path)
    if not src.is_file():
        raise CryptoError(f"Archivo cifrado no encontrado: {src}")
    dst = Path(output_path) if output_path else src.with_name(src.name + ".dec")
    key = resolve_key(config=config, key_b64=key_b64)
    iv = b64decode(iv_b64) if iv_b64 else b"\x00" * 12
    if not iv:
        iv = b"\x00" * 12
    tag = b64decode(auth_tag_b64) if auth_tag_b64 else b""
    data = src.read_bytes()

    if HAS_AESGCM:
        try:
            plaintext = AESGCM(key).decrypt(iv, data + tag if tag else data, None)
        except Exception as exc:  # noqa: BLE001 - InvalidTag u otros
            raise CryptoError(f"Falló descifrado AES-256-GCM (tag inválido): {exc}") from exc
    else:
        if config is None or not config.demo_mode:
            raise CryptoError("'cryptography' no está instalado; AES-256-GCM no disponible")
        _warn_demo()
        digest = hashlib.sha256()
        if tag:
            plaintext = _xor_stream(data, key, iv)
            digest.update(plaintext)
            if not hmac.compare_digest(digest.digest(), tag):
                raise CryptoError("Checksum INSEGURO del modo DEMO no coincide")
        else:
            if len(data) < 32:
                raise CryptoError("Archivo DEMO demasiado corto para contener su SHA-256")
            body, embedded = data[:-32], data[-32:]
            plaintext = _xor_stream(body, key, iv)
            if not hmac.compare_digest(hashlib.sha256(plaintext).digest(), embedded):
                raise CryptoError("Checksum INSEGURO del modo DEMO no coincide")

    return _write_private(dst, plaintext)


def encrypt_file(
    plaintext_path: str | Path,
    output_path: str | Path,
    *,
    config: Config | None = None,
    key_b64: str | None = None,
    iv_b64: str | None = None,
) -> dict[str, str]:
    """Cifra un archivo (útil para regenerar la copia de contingencia)."""
    src = Path(plaintext_path)
    key = resolve_key(config=config, key_b64=key_b64)
    iv = b64decode(iv_b64) if iv_b64 else os.urandom(12)
    data = src.read_bytes()
    if HAS_AESGCM:
        ciphertext = AESGCM(key).encrypt(iv, data, None)
        result = {"key_b64": b64encode(key), "iv_b64": b64encode(iv), "auth_tag_b64": ""}
    else:
        if config is None or not config.demo_mode:
            raise CryptoError("'cryptography' no está instalado; cifrado seguro no disponible")
        _warn_demo()
        ciphertext = _xor_stream(data, key, iv) + hashlib.sha256(data).digest()
        result = {
            "key_b64": b64encode(key),
            "iv_b64": b64encode(iv),
            "auth_tag_b64": "",
            "demo_insecure": True,
        }
    _write_private(Path(output_path), ciphertext)
    return result


def verify_checksum(path: str | Path, expected: str | None) -> bool:
    """Verifica ``sha256:hex`` (o hex directo) de un archivo."""
    if not expected:
        log.debug("Sin checksum declarado; se omite verificación")
        return True
    wanted = str(expected).strip().lower()
    if wanted.startswith("sha256:"):
        wanted = wanted[7:]
    wanted = wanted.strip()
    if not wanted:
        return True
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if wanted in (actual, "sha256:" + actual):
        return True
    # Permitir SHA-256 en base64 (algunos backends lo entregan así).
    try:
        if hmac.compare_digest(b64decode(wanted), digest.digest()):
            return True
    except Exception:  # noqa: BLE001
        pass
    log.error("Checksum SHA-256 no coincide: esperado=%s actual=%s", wanted[:16], actual[:16])
    return False


def wipe_file(path: str | Path, passes: int = 1) -> None:
    """Sobrescribe el archivo con ceros antes de borrarlo (mejor esfuerzo)."""
    target = Path(path)
    if not target.exists():
        return
    try:
        size = target.stat().st_size
        with open(target, "r+b", buffering=0) as handle:
            for _ in range(max(1, passes)):
                handle.seek(0)
                remaining = size
                while remaining > 0:
                    chunk = b"\x00" * min(1024 * 1024, remaining)
                    handle.write(chunk)
                    remaining -= len(chunk)
                handle.flush()
                os.fsync(handle.fileno())
    except OSError as exc:
        log.warning("No se pudo sobrescribir %s antes de borrarlo: %s", target, exc)
    try:
        target.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("No se pudo borrar %s: %s", target, exc)
