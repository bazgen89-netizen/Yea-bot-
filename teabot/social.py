"""Каталог соцсетей и правила валидации поста перед кросспостингом.

Модуль не ходит в сеть — только описывает ограничения площадок и проверяет,
что пост им соответствует. Сам вызов API живёт в services/social.py.
"""
from dataclasses import dataclass, field
from typing import FrozenSet, Iterable, List, Sequence, Tuple


@dataclass(frozen=True)
class Network:
    """Одна площадка: код Metricool, подпись для кнопки и ограничения."""
    code: str
    title: str
    text_limit: int
    requires_media: bool = False


# Коды соответствуют полю `network` в API Metricool.
NETWORKS = {
    n.code: n
    for n in (
        Network("instagram", "📸 Instagram", 2200, requires_media=True),
        Network("facebook", "👥 Facebook", 5000),
        Network("pinterest", "📌 Pinterest", 500, requires_media=True),
        Network("youtube", "▶️ YouTube", 5000, requires_media=True),
        Network("tiktok", "🎵 TikTok", 2200, requires_media=True),
        Network("twitter", "🐦 X (Twitter)", 280),
        Network("linkedin", "💼 LinkedIn", 3000),
        Network("threads", "🧵 Threads", 500),
        Network("bluesky", "🦋 Bluesky", 300),
    )
}


@dataclass(frozen=True)
class SocialConfig:
    """Какие сети доступны боту и кому разрешено публиковать от имени бренда."""
    networks: Tuple[str, ...] = ()
    admins: FrozenSet[int] = field(default_factory=frozenset)

    def allows(self, user_id: int) -> bool:
        """Пустой список админов = публиковать нельзя никому (безопасное умолчание)."""
        return user_id in self.admins


def known(codes: Iterable[str]) -> List[str]:
    """Оставляет только коды, которые бот умеет публиковать, сохраняя порядок."""
    return [c for c in codes if c in NETWORKS]


def title(code: str) -> str:
    net = NETWORKS.get(code)
    return net.title if net else code


def validate(text: str, media: Sequence[str], networks: Sequence[str]) -> List[str]:
    """Возвращает список проблем поста. Пустой список — можно публиковать."""
    problems: List[str] = []

    if not networks:
        problems.append("Не выбрана ни одна соцсеть.")
    if not text.strip() and not media:
        problems.append("Пост пустой: нужен текст или медиа.")

    for code in networks:
        net = NETWORKS.get(code)
        if net is None:
            problems.append(f"Неизвестная сеть: {code}")
            continue
        if net.requires_media and not media:
            problems.append(f"{net.title}: нужна ссылка на фото или видео.")
        if len(text) > net.text_limit:
            problems.append(
                f"{net.title}: текст {len(text)} символов, лимит {net.text_limit}."
            )

    return problems
