"""Выдача и отзыв ключей VPN (VLESS + Reality).

Список пользователей хранится в JSON-файле, который читает генератор
серверного конфига (vpn/tools/gen_server_config.py). После изменения файла
вызывается внешняя команда перезапуска Xray — сам бот к серверу не ходит,
поэтому его можно держать отдельно от VPN-ноды (общий каталог или ssh-обёртка
в VPN_RELOAD_CMD).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import uuid as uuid_lib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

logger = logging.getLogger(__name__)

RELOAD_TIMEOUT = 60
SUB_TOKEN_BYTES = 16


@dataclass(frozen=True)
class VpnServer:
    """Параметры подключения, общие для всех ключей."""
    host: str
    port: int
    public_key: str
    short_id: str
    sni: str
    flow: str = "xtls-rprx-vision"
    fingerprint: str = "chrome"

    @classmethod
    def from_env(cls) -> "VpnServer":
        short_ids = os.getenv("REALITY_SHORT_IDS", "")
        return cls(
            host=os.getenv("VPN_HOST", ""),
            port=int(os.getenv("VPN_PORT", "443")),
            public_key=os.getenv("REALITY_PUBLIC_KEY", ""),
            short_id=short_ids.split(",")[0].strip(),
            sni=os.getenv("REALITY_SNI", "www.microsoft.com"),
        )

    @property
    def configured(self) -> bool:
        return bool(self.host and self.public_key)

    def link(self, user_uuid: str, label: str) -> str:
        """vless://-ссылка для v2rayNG, Hiddify, Streisand, NekoBox."""
        params = (
            f"type=tcp&security=reality&sni={quote(self.sni)}"
            f"&fp={self.fingerprint}&pbk={quote(self.public_key)}"
            f"&sid={quote(self.short_id)}&flow={self.flow}"
        )
        return f"vless://{user_uuid}@{self.host}:{self.port}?{params}#{quote(label)}"


class VpnManager:
    """Хранилище ключей поверх JSON-файла с блокировкой и атомарной записью."""

    def __init__(self, server: VpnServer, users_path: str | Path,
                 reload_cmd: str = "", max_keys_per_user: int = 3):
        self.server = server
        self.users_path = Path(users_path)
        self.reload_cmd = reload_cmd
        self.max_keys_per_user = max_keys_per_user
        self._lock = asyncio.Lock()

    # --- чтение/запись ---------------------------------------------------- #

    def _read(self) -> list[dict]:
        if not self.users_path.exists():
            return []
        try:
            return json.loads(self.users_path.read_text(encoding="utf-8")).get("users", [])
        except (json.JSONDecodeError, OSError) as e:
            logger.error(f"users.json нечитаем: {e}")
            raise

    def _write(self, users: list[dict]) -> None:
        self.users_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.users_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"users": users}, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        tmp.replace(self.users_path)  # атомарная подмена: файл не увидят пустым

    async def _reload(self) -> str:
        """Применяет изменения на сервере. Возвращает текст для лога/ответа."""
        if not self.reload_cmd:
            return "⚠️ VPN_RELOAD_CMD не задан — примените конфиг вручную"
        try:
            proc = await asyncio.create_subprocess_shell(
                self.reload_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=RELOAD_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            return "⚠️ перезапуск Xray не уложился в тайм-аут"
        except OSError as e:
            return f"⚠️ не удалось запустить перезапуск: {e}"
        if proc.returncode != 0:
            logger.error(f"reload failed: {out.decode(errors='replace')[:500]}")
            return f"⚠️ перезапуск Xray вернул код {proc.returncode}"
        return "✅ конфиг применён"

    # --- операции --------------------------------------------------------- #

    async def list_keys(self, tg_id: int | None = None) -> list[dict]:
        async with self._lock:
            users = self._read()
        active = [u for u in users if not u.get("revoked")]
        if tg_id is None:
            return active
        return [u for u in active if u.get("tg_id") == tg_id]

    async def issue(self, tg_id: int, label: str) -> tuple[dict | None, str]:
        """Выдаёт новый ключ. Возвращает (ключ, статус применения)."""
        async with self._lock:
            users = self._read()
            mine = [u for u in users if u.get("tg_id") == tg_id and not u.get("revoked")]
            if len(mine) >= self.max_keys_per_user:
                return None, f"❌ достигнут лимит ключей ({self.max_keys_per_user})"

            user = {
                "uuid": str(uuid_lib.uuid4()),
                # Токен подписки живёт отдельно от uuid, чтобы менять адрес
                # подписки, не выпуская новый ключ.
                "sub_token": secrets.token_urlsafe(SUB_TOKEN_BYTES),
                "label": label,
                "tg_id": tg_id,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            users.append(user)
            self._write(users)

        return user, await self._reload()

    async def revoke(self, key_uuid: str, tg_id: int | None = None) -> tuple[bool, str]:
        """Отзывает ключ. tg_id ограничивает отзыв своими ключами."""
        async with self._lock:
            users = self._read()
            target = next(
                (u for u in users
                 if u["uuid"] == key_uuid and not u.get("revoked")
                 and (tg_id is None or u.get("tg_id") == tg_id)),
                None,
            )
            if target is None:
                return False, "❌ ключ не найден"
            target["revoked"] = True
            target["revoked_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._write(users)

        return True, await self._reload()

    async def find_by_token(self, token: str) -> dict | None:
        """Ищет активный ключ по токену подписки (для эндпоинта /sub/<token>)."""
        if not token:
            return None
        async with self._lock:
            users = self._read()
        # compare_digest принимает строки только из ASCII, а токен приходит
        # из URL и может быть любым, — сравниваем в байтах.
        wanted = token.encode("utf-8")
        return next(
            (u for u in users
             if not u.get("revoked")
             and secrets.compare_digest(u.get("sub_token", "").encode("utf-8"), wanted)),
            None,
        )

    async def ensure_token(self, key_uuid: str) -> str:
        """Токен подписки для ключа; выдаёт новый, если его ещё нет."""
        async with self._lock:
            users = self._read()
            user = next((u for u in users if u["uuid"] == key_uuid), None)
            if user is None:
                return ""
            if not user.get("sub_token"):
                user["sub_token"] = secrets.token_urlsafe(SUB_TOKEN_BYTES)
                self._write(users)
            return user["sub_token"]

    def link(self, user: dict) -> str:
        return self.server.link(user["uuid"], user.get("label", "vpn"))
