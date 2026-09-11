"""Память о уже показанных входящих: чтобы один отзыв не приходил дважды.

Хранится в файле (SOCIAL_STATE_PATH) — на Render диск эфемерный, поэтому
после передеплоя память обнуляется: это осознанный компромисс, худший
случай — повторный показ свежих сообщений один раз.
"""
import json
import logging
import os
from collections import deque
from typing import Iterable, Optional

logger = logging.getLogger(__name__)


class SeenStore:
    """Ограниченный по размеру набор идентификаторов уже обработанных элементов."""

    def __init__(self, path: Optional[str] = None, max_size: int = 2000):
        self.path = path
        self.max_size = max_size
        self._order: deque = deque(maxlen=max_size)
        self._seen: set[str] = set()
        self.load()

    def is_new(self, uid: str) -> bool:
        return uid not in self._seen

    def mark(self, uid: str) -> None:
        if uid in self._seen:
            return
        if len(self._order) == self._order.maxlen and self._order:
            self._seen.discard(self._order[0])
        self._order.append(uid)
        self._seen.add(uid)

    def mark_all(self, uids: Iterable[str]) -> None:
        for uid in uids:
            self.mark(uid)

    def filter_new(self, items: Iterable) -> list:
        """Оставляет только новые элементы и сразу помечает их обработанными."""
        fresh = []
        for item in items:
            if self.is_new(item.uid):
                self.mark(item.uid)
                fresh.append(item)
        return fresh

    def load(self) -> None:
        if not self.path or not os.path.exists(self.path):
            return
        try:
            with open(self.path, encoding="utf-8") as f:
                uids = json.load(f)
            self.mark_all(uids[-self.max_size:])
        except (OSError, ValueError) as e:
            logger.warning("Не удалось прочитать состояние соцсетей: %s", e)

    def save(self) -> None:
        if not self.path:
            return
        try:
            directory = os.path.dirname(self.path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(list(self._order), f)
        except OSError as e:
            logger.warning("Не удалось сохранить состояние соцсетей: %s", e)

    def __len__(self) -> int:
        return len(self._seen)
