"""Единые модели для всех соцсетей: входящий элемент и результат публикации."""
import html
import time
from dataclasses import dataclass, field
from typing import Optional


# Виды входящих элементов
KIND_MESSAGE = "message"   # личное сообщение / диалог
KIND_COMMENT = "comment"   # комментарий под постом
KIND_REVIEW = "review"     # отзыв (Яндекс/Google Карты, маркетплейсы)
KIND_MENTION = "mention"   # упоминание бренда

KIND_TITLES = {
    KIND_MESSAGE: "💬 Сообщение",
    KIND_COMMENT: "🗨 Комментарий",
    KIND_REVIEW: "⭐ Отзыв",
    KIND_MENTION: "📣 Упоминание",
}


@dataclass(frozen=True)
class SocialItem:
    """Входящий элемент из любой сети, приведённый к единому виду.

    thread_id — идентификатор, по которому коннектор отправляет ответ
    (peer_id диалога, id комментария, имя ресурса отзыва и т. п.).
    """
    network: str
    kind: str
    item_id: str
    author: str
    text: str
    created_at: float = field(default_factory=time.time)
    thread_id: str = ""
    url: str = ""
    rating: Optional[int] = None
    raw: dict = field(default_factory=dict, repr=False, compare=False)

    @property
    def uid(self) -> str:
        """Глобально уникальный ключ для дедупликации между опросами."""
        return f"{self.network}:{self.kind}:{self.item_id}"

    @property
    def reply_to(self) -> str:
        return self.thread_id or self.item_id

    def format(self, title: str = "") -> str:
        """HTML-карточка для отправки в Telegram."""
        head = KIND_TITLES.get(self.kind, "📨 Входящее")
        stars = f" {'⭐' * self.rating}" if self.rating else ""
        when = time.strftime("%d.%m %H:%M", time.localtime(self.created_at))
        lines = [
            f"{head} · <b>{html.escape(title or self.network)}</b>{stars}",
            f"👤 {html.escape(self.author or 'аноним')} · {when}",
            "",
            html.escape(self.text.strip()[:1500]) or "<i>(без текста)</i>",
        ]
        if self.url:
            lines.append(f"\n🔗 {html.escape(self.url)}")
        return "\n".join(lines)


@dataclass(frozen=True)
class PublishResult:
    """Результат публикации/ответа в одной сети."""
    network: str
    ok: bool
    url: str = ""
    error: str = ""

    def format(self, title: str = "") -> str:
        name = title or self.network
        if self.ok:
            return f"✅ {name}" + (f" — {self.url}" if self.url else "")
        return f"❌ {name} — {self.error or 'ошибка'}"
