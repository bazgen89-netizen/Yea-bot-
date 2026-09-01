"""Два мозга бота: основной отвечает, второй подстраховывает.

Если основная модель вернула ошибку (нет ключа, rate limit, таймаут,
пустой ответ), тот же вопрос уходит запасной. Для вызывающего кода
роутер выглядит как обычный AI-клиент: у него есть ask() и health_check().
"""
import logging
from typing import Mapping, Optional

logger = logging.getLogger(__name__)

# Клиенты не бросают исключения, а возвращают текст ошибки с этим маркером
ERROR_MARK = "⚠️"


def is_error_answer(text: str) -> bool:
    return not text or text.strip().startswith(ERROR_MARK)


class AIRouter:
    """Выбирает, каким мозгом отвечать, и переключается на запасной при сбое."""

    def __init__(self, brains: Mapping[str, object], primary: str = ""):
        if not brains:
            raise ValueError("Нужен хотя бы один AI-клиент")
        self.brains = dict(brains)
        self.primary = primary if primary in self.brains else next(iter(self.brains))

    # ------------------------------------------------------------ доступ

    @property
    def primary_brain(self):
        return self.brains[self.primary]

    @property
    def secondary_brain(self):
        """Первый доступный мозг, кроме основного."""
        for name, brain in self.brains.items():
            if name != self.primary and getattr(brain, "available", False):
                return brain
        return None

    @property
    def model(self) -> str:
        return getattr(self.primary_brain, "model", "")

    @property
    def api_key(self) -> str:
        return getattr(self.primary_brain, "api_key", "")

    @property
    def available(self) -> bool:
        return any(getattr(b, "available", False) for b in self.brains.values())

    def names(self) -> list[str]:
        return list(self.brains)

    def find(self, name: str) -> Optional[object]:
        return self.brains.get(name.strip().lower())

    def switch(self, name: str) -> bool:
        """Меняет основной мозг. False — если такого мозга нет."""
        key = name.strip().lower()
        if key not in self.brains:
            return False
        self.primary = key
        return True

    # ------------------------------------------------------------ ответы

    async def ask(self, prompt: str, system: str = "") -> str:
        primary = self.primary_brain
        answer = ""

        if getattr(primary, "available", False):
            answer = await primary.ask(prompt, system=system)
            if not is_error_answer(answer):
                return answer

        backup = self.secondary_brain
        if backup is None:
            return answer or f"{ERROR_MARK} AI не настроен: задайте ключ хотя бы одной модели."

        logger.info(
            "🧠 %s не ответил (%s) — спрашиваю %s",
            getattr(primary, "name", self.primary), (answer or "нет ключа")[:60],
            getattr(backup, "name", "запасной"),
        )
        fallback = await backup.ask(prompt, system=system)
        return fallback if not is_error_answer(fallback) else (answer or fallback)

    async def ask_brain(self, name: str, prompt: str, system: str = "") -> str:
        """Спросить конкретный мозг — например, второе мнение."""
        brain = self.find(name)
        if brain is None:
            return f"{ERROR_MARK} Мозг «{name}» не подключён."
        return await brain.ask(prompt, system=system)

    # ----------------------------------------------------------- статусы

    async def statuses(self) -> list[tuple[str, str, str]]:
        """(имя, модель, статус) по каждому мозгу — для /debug и /brain."""
        out = []
        for name, brain in self.brains.items():
            status = await brain.health_check()
            out.append((getattr(brain, "name", name), getattr(brain, "model", ""), status))
        return out

    async def health_check(self) -> str:
        return " | ".join(f"{name}: {status}" for name, _, status in await self.statuses())
