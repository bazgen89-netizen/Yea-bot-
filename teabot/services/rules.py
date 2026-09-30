"""Загрузка правил маршрутизации: группы сервисов и страновые профили.

Данные лежат в vpn/ и используются двумя потребителями — генератором
клиентских конфигов (vpn/tools/gen_client_config.py) и ботом, который
отдаёт подписку. Модуль общий, чтобы списки не разъезжались.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICES_PATH = ROOT / "vpn" / "data" / "services.json"
PROFILES_DIR = ROOT / "vpn" / "config" / "profiles"


def load_services(path: Path = SERVICES_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["groups"]


def load_profile(name: str, profiles_dir: Path = PROFILES_DIR) -> dict:
    path = profiles_dir / f"{name}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in profiles_dir.glob("*.json")))
        raise ValueError(f"Профиль '{name}' не найден. Доступные: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def dedup(items: list[str]) -> list[str]:
    """Уникальные значения с сохранением порядка."""
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def collect_domains(profile: dict, services: dict, groups: list[str] | None = None,
                    with_geosite: bool = False) -> tuple[list[str], list[str]]:
    """Возвращает (домены для проксирования, теги geosite для проксирования)."""
    wanted = groups if groups is not None else profile.get("groups", [])
    domains: list[str] = []
    geosite: list[str] = []
    for name in wanted:
        group = services.get(name)
        if group is None:
            raise ValueError(f"Неизвестная группа сервисов: {name}")
        domains.extend(group.get("domains", []))
        if with_geosite:
            geosite.extend(group.get("geosite", []))
    return dedup(domains), dedup(geosite)
