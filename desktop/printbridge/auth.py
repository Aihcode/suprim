"""Validación del token JWT de estación (HS256).

Usa PyJWT cuando está disponible; si no, verifica la firma HMAC-SHA256 a mano.
En modo DEMO se aceptan tokens opacos (no JWT) con un aviso por log: el backend
sigue siendo la autoridad final que valida el token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

from .config import Config

log = logging.getLogger(__name__)


class TokenError(ValueError):
    """Token ausente, malformado, caducado o con firma inválida."""


@dataclass
class TokenInfo:
    claims: dict[str, Any]
    signature_verified: bool
    expired: bool = False
    reason: str = ""


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _candidate_secrets(config: Config | None = None) -> list[str]:
    secrets: list[str] = []
    if config is not None and config.jwt_secret:
        secrets.append(config.jwt_secret)
    for name in ("JWT_SECRET", "NEXTAUTH_SECRET", "STATION_JWT_SECRET"):
        value = os.environ.get(name, "")
        if value and value not in secrets:
            secrets.append(value)
    if config is not None and config.demo_mode:
        for value in ("demo-token", "demo-secret"):
            if value not in secrets:
                secrets.append(value)
    return secrets


def _manual_decode(token: str, secrets: list[str]) -> tuple[dict[str, Any], dict[str, Any], bool, str]:
    """Decodifica un JWT HS256 sin dependencias. Devuelve (header, payload, verificado, razón)."""
    parts = token.split(".")
    if len(parts) != 3:
        raise TokenError("El token no tiene formato JWT de 3 segmentos")
    header_seg, payload_seg, signature_seg = parts
    try:
        header = json.loads(_b64url_decode(header_seg).decode("utf-8"))
        payload = json.loads(_b64url_decode(payload_seg).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise TokenError(f"Segmentos JWT inválidos: {exc}") from exc
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise TokenError("El JWT debe contener objetos JSON")
    if str(header.get("alg", "")).upper() != "HS256":
        raise TokenError(f"Algoritmo JWT no soportado: {header.get('alg')!r} (se espera HS256)")

    signing_input = f"{header_seg}.{payload_seg}".encode("ascii")
    try:
        provided = _b64url_decode(signature_seg)
    except Exception as exc:  # noqa: BLE001 - firma malformada
        raise TokenError(f"Firma JWT malformada: {exc}") from exc
    for secret in secrets:
        expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        if hmac.compare_digest(provided, expected):
            return header, payload, True, ""
    return header, payload, False, "No se encontró una clave HS256 que valide la firma"


def _check_claims(payload: dict[str, Any], leeway_s: int = 30) -> tuple[bool, str]:
    now = int(time.time())
    exp = payload.get("exp")
    if exp is not None:
        try:
            if now - leeway_s >= int(exp):
                return True, "El token JWT ha caducado"
        except (TypeError, ValueError):
            return False, "Claim exp inválido"
    nbf = payload.get("nbf")
    if nbf is not None:
        try:
            if now + leeway_s < int(nbf):
                return True, "El token JWT todavía no es válido (nbf)"
        except (TypeError, ValueError):
            return False, "Claim nbf inválido"
    return False, ""


def decode_station_token(
    token: str,
    config: Config | None = None,
    *,
    require_signature: bool = False,
) -> TokenInfo:
    """Valida un JWT HS256 de estación y devuelve sus claims.

    * Con PyJWT: verifica firma con las claves candidatas y ``exp``/``nbf``.
    * Sin PyJWT: verificación HMAC-SHA256 manual equivalente.
    * ``require_signature=True`` falla si no se pudo verificar la firma.
    """
    if not token or not str(token).strip():
        raise TokenError("Token de estación vacío")
    token = str(token).strip()
    secrets = _candidate_secrets(config)

    if not (token.count(".") == 2):
        if config is not None and config.demo_mode:
            log.warning("DEMO: token opaco aceptado sin verificación JWT local")
            return TokenInfo({"sub": config.station_id, "demo": True}, False, False, "token opaco en DEMO")
        raise TokenError("Token de estación no es un JWT")

    try:
        import jwt  # type: ignore
    except ImportError:
        jwt = None  # type: ignore

    verified = False
    reason = ""
    if jwt is not None:
        last_error: Exception | None = None
        for secret in secrets or [""]:
            try:
                claims = jwt.decode(
                    token,
                    secret,
                    algorithms=["HS256"],
                    options={"verify_exp": True, "verify_nbf": True, "require": []},
                    leeway=30,
                )
                verified = bool(secret)
                return TokenInfo(dict(claims), verified, False, "")
            except Exception as exc:  # noqa: BLE001 - PyJWT lanza varias excepciones
                last_error = exc
        if last_error is not None:
            # Último recurso: decodificar sin verificar firma para inspeccionar claims.
            try:
                payload = jwt.decode(
                    token,
                    options={"verify_signature": False, "verify_exp": False, "verify_nbf": False},
                    algorithms=["HS256"],
                )
            except Exception as exc:  # noqa: BLE001
                raise TokenError(f"JWT inválido: {exc}") from exc
            expired, reason = _check_claims(dict(payload))
            if expired:
                raise TokenError(reason)
            if require_signature:
                raise TokenError("No se pudo verificar la firma HS256 del token")
            log.warning("JWT decodificado sin verificación de firma: %s", last_error)
            return TokenInfo(dict(payload), False, expired, str(last_error))
    else:
        _header, payload, verified, reason = _manual_decode(token, secrets)
        expired, claim_reason = _check_claims(payload)
        if expired:
            raise TokenError(claim_reason)
        if not verified and require_signature:
            raise TokenError(reason or "Firma HS256 inválida")
        if not verified:
            log.warning("Verificación HMAC local inconclusa: %s", reason)
        return TokenInfo(payload, verified, expired, reason)

    return TokenInfo({}, False, False, "no se pudo decodificar el token")


def validate_station_token(token: str, config: Config | None = None) -> tuple[bool, str]:
    """Compatibilidad rápida: ``(válido, motivo)``."""
    try:
        info = decode_station_token(token, config)
        return True, "OK" if info.signature_verified else "Aceptado sin verificación local de firma"
    except TokenError as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001 - nunca derribar el agente por un token
        return False, f"Error validando token: {exc}"


def subject_of(info: TokenInfo) -> str:
    claims = info.claims or {}
    for key in ("sub", "station_id", "stationId", "station"):
        value = claims.get(key)
        if value:
            return str(value)
    return ""
