"""Реестр магазинов: чтение stores.json.

Файл описывает точки и их идентификаторы на площадках. Формат — см.
stores.example.json и docs/STORES.md. Путь задаётся переменной STORES_FILE.
"""
import json
import logging
from pathlib import Path
from typing import Iterable, Optional

from .models import PLATFORM_TITLES, PlatformRef, Store

logger = logging.getLogger(__name__)


class StoreRegistry:
    """Список магазинов, загруженный из JSON. Пустой реестр — не ошибка."""

    def __init__(self, stores: Iterable[Store] = ()):
        self._stores: list[Store] = list(stores)

    def __len__(self) -> int:
        return len(self._stores)

    def __iter__(self):
        return iter(self._stores)

    @property
    def stores(self) -> list[Store]:
        return list(self._stores)

    def get(self, slug: str) -> Optional[Store]:
        return next((s for s in self._stores if s.slug == slug), None)

    def platforms_in_use(self) -> set[str]:
        return {p for store in self._stores for p in store.refs}

    @classmethod
    def from_file(cls, path: str | Path) -> "StoreRegistry":
        p = Path(path)
        if not p.is_file():
            logger.info(f"Реестр магазинов не найден: {p} — раздел «Магазины» отключён")
            return cls()
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            logger.error(f"Не удалось прочитать реестр магазинов {p}: {e}")
            return cls()
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> "StoreRegistry":
        stores: list[Store] = []
        for item in raw.get("stores", []):
            slug = item.get("slug") or item.get("name", "")
            if not slug:
                logger.warning("Пропущен магазин без slug/name в реестре")
                continue
            refs: dict[str, PlatformRef] = {}
            for platform, data in (item.get("platforms") or {}).items():
                if platform not in PLATFORM_TITLES:
                    logger.warning(f"{slug}: неизвестная площадка «{platform}» — пропущена")
                    continue
                if isinstance(data, str):
                    data = {"id": data}
                refs[platform] = PlatformRef(
                    platform=platform,
                    external_id=str(data.get("id", "")),
                    owner_id=str(data.get("owner_id", "")),
                    query=data.get("query", ""),
                    url=data.get("url", ""),
                )
            stores.append(Store(
                slug=slug,
                name=item.get("name", slug),
                city=item.get("city", ""),
                address=item.get("address", ""),
                refs=refs,
            ))
        logger.info(f"Реестр магазинов: загружено {len(stores)} точек")
        return cls(stores)
