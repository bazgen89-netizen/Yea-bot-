"""Мониторинг новых отзывов.

Хранит идентификаторы уже виденных отзывов в JSON-файле, чтобы при перезапуске
процесса не присылать одни и те же уведомления повторно. Файл маленький
(набор ключей), запись атомарная — через временный файл и rename.

Первый запуск считается «прогревочным»: все существующие отзывы помечаются
виденными без уведомлений, иначе владелец получил бы сразу всю историю.
"""
import json
import logging
from pathlib import Path
from typing import Optional

from .models import Review
from .service import StoresService

logger = logging.getLogger(__name__)

# Больше ключей хранить незачем: старые отзывы уже не «новые»
MAX_SEEN_KEYS = 2000


class ReviewMonitor:
    """Находит отзывы, которых не было при прошлой проверке."""

    def __init__(self, service: StoresService, state_path: str | Path,
                 limit_per_store: int = 10):
        self.service = service
        self.state_path = Path(state_path)
        self.limit_per_store = limit_per_store
        self._seen: list[str] = []
        self._primed = False
        self._load()

    # --- состояние ---------------------------------------------------------

    def _load(self) -> None:
        if not self.state_path.is_file():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            self._seen = list(data.get("seen", []))
            self._primed = bool(data.get("primed", bool(self._seen)))
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Состояние мониторинга отзывов не прочитано: {e}")

    def _save(self) -> None:
        payload = {"primed": self._primed, "seen": self._seen[-MAX_SEEN_KEYS:]}
        tmp = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.state_path)
        except OSError as e:
            logger.warning(f"Состояние мониторинга отзывов не сохранено: {e}")

    # --- проверка ----------------------------------------------------------

    async def check(self) -> list[Review]:
        """Возвращает новые отзывы и запоминает их как виденные."""
        reviews = await self.service.all_reviews(self.limit_per_store)
        if not reviews:
            return []

        seen = set(self._seen)
        fresh = [r for r in reviews if r.key not in seen]
        self._seen.extend(r.key for r in fresh)

        if not self._primed:
            # Первый запуск: запоминаем историю молча
            self._primed = True
            self._save()
            logger.info(f"Мониторинг отзывов: запомнено {len(fresh)} существующих отзывов")
            return []

        if fresh:
            self._save()
        return fresh


async def notify_new_reviews(monitor: ReviewMonitor, bot, chat_id: int,
                             formatter, titles: dict[str, str]) -> Optional[int]:
    """Проверяет отзывы и отправляет новые в чат владельца.

    Возвращает количество отправленных отзывов (None — мониторинг пропущен).
    Вынесено из job-обёртки, чтобы можно было вызвать и протестировать отдельно.
    """
    if not chat_id:
        return None
    fresh = await monitor.check()
    for review in fresh:
        await bot.send_message(
            chat_id=chat_id,
            text="🆕 <b>Новый отзыв о магазине</b>\n\n"
                 + formatter(review, titles.get(review.store_slug, "")),
            parse_mode="HTML",
            disable_web_page_preview=True,
        )
    return len(fresh)
