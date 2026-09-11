"""Приём событий, которые площадки присылают сами (webhook).

Опрос работает не везде: WhatsApp вообще не отдаёт входящие по запросу —
Meta присылает их на webhook. Для Instagram и Facebook webhook снимает
задержку опроса: сообщение появляется в чате сразу, а не через три минуты.

Здесь только разбор входящего тела в SocialItem и проверка подписи.
Доставку в админский чат делает тот же путь, что и для опроса.
"""
import hashlib
import hmac
import logging
import time

from .models import KIND_COMMENT, KIND_MESSAGE, SocialItem

logger = logging.getLogger(__name__)


def verify_signature(body: bytes, header: str, app_secret: str) -> bool:
    """Проверяет X-Hub-Signature-256. Без секрета проверка не выполняется."""
    if not app_secret:
        return True
    if not header or not header.startswith("sha256="):
        return False
    digest = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, header[len("sha256="):].strip())


def _ts(value, default=None) -> float:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return default if default is not None else time.time()
    # Meta присылает миллисекунды в части событий
    return seconds / 1000 if seconds > 1e11 else seconds


def _whatsapp_items(value: dict) -> list[SocialItem]:
    """Входящие WhatsApp: сообщения клиентов, без отчётов о доставке."""
    names = {
        c.get("wa_id"): (c.get("profile") or {}).get("name", "")
        for c in value.get("contacts", [])
    }
    items = []
    for msg in value.get("messages", []):
        sender = str(msg.get("from", ""))
        body = (msg.get("text") or {}).get("body") or f"[{msg.get('type', 'вложение')}]"
        items.append(SocialItem(
            network="whatsapp",
            kind=KIND_MESSAGE,
            item_id=str(msg.get("id", "")),
            author=names.get(sender) or sender or "клиент",
            text=body,
            created_at=_ts(msg.get("timestamp")),
            thread_id=sender,
            raw=msg,
        ))
    return items


def _messaging_items(network: str, entry: dict) -> list[SocialItem]:
    """Личные сообщения Messenger и Instagram Direct."""
    items = []
    for event in entry.get("messaging", []):
        message = event.get("message") or {}
        if message.get("is_echo") or not message:
            continue  # наш собственный ответ
        sender = str((event.get("sender") or {}).get("id", ""))
        items.append(SocialItem(
            network=network,
            kind=KIND_MESSAGE,
            item_id=str(message.get("mid", "")),
            author=sender or "клиент",
            text=message.get("text", "") or "[вложение]",
            created_at=_ts(event.get("timestamp")),
            thread_id=sender,
            raw=event,
        ))
    return items


def _facebook_comment(value: dict) -> list[SocialItem]:
    """Комментарии под постами страницы."""
    if value.get("item") != "comment" or value.get("verb") not in (None, "add"):
        return []
    author = value.get("from") or {}
    return [SocialItem(
        network="facebook",
        kind=KIND_COMMENT,
        item_id=str(value.get("comment_id", "")),
        author=author.get("name", "гость"),
        text=value.get("message", ""),
        created_at=_ts(value.get("created_time")),
        thread_id=str(value.get("comment_id", "")),
        url=f"https://facebook.com/{value.get('post_id', '')}",
        raw=value,
    )]


def _instagram_comment(value: dict) -> list[SocialItem]:
    author = value.get("from") or {}
    return [SocialItem(
        network="instagram",
        kind=KIND_COMMENT,
        item_id=str(value.get("id", "")),
        author=author.get("username", "instagram"),
        text=value.get("text", ""),
        created_at=time.time(),
        thread_id=str(value.get("id", "")),
        url=f"https://www.instagram.com/p/{(value.get('media') or {}).get('id', '')}",
        raw=value,
    )]


def parse_meta_payload(payload: dict) -> list[SocialItem]:
    """Разбирает тело webhook Meta в общие элементы хаба.

    Одна точка приёма обслуживает WhatsApp, Instagram и Facebook: Meta
    различает их полем object. Незнакомые события пропускаем молча —
    подписка может включать больше типов, чем нам нужно.
    """
    obj = payload.get("object", "")
    items: list[SocialItem] = []

    for entry in payload.get("entry", []):
        if obj == "instagram":
            items += _messaging_items("instagram", entry)
        elif obj == "page":
            items += _messaging_items("facebook", entry)

        for change in entry.get("changes", []):
            field, value = change.get("field", ""), change.get("value") or {}
            if field == "messages":
                items += _whatsapp_items(value)
            elif field == "feed":
                items += _facebook_comment(value)
            elif field == "comments":
                items += _instagram_comment(value)

    return [i for i in items if i.item_id]
