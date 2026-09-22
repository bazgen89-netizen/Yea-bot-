"""Приём событий, которые площадки присылают сами (webhook).

Опрос работает не везде: WhatsApp вообще не отдаёт входящие по запросу —
Meta присылает их на webhook. У ВКонтакте по запросу читаются только
диалоги, а комментарии под постами приходят событием Callback API.
Для Instagram и Facebook webhook вдобавок снимает задержку опроса:
сообщение появляется в чате сразу, а не через три минуты.

Здесь только разбор входящего тела в SocialItem и проверка подлинности.
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


def _vk_author(payload: dict, user_id) -> str:
    """Имя автора из блока profiles, если ВКонтакте его прислал."""
    for profile in (payload.get("profiles") or []):
        if profile.get("id") == user_id:
            return f"{profile.get('first_name', '')} {profile.get('last_name', '')}".strip()
    return f"id{user_id}" if user_id else "клиент"


def parse_vk_payload(payload: dict) -> list[SocialItem]:
    """События Callback API ВКонтакте: сообщения и комментарии под постами.

    Комментарии иначе не увидеть: по запросу отдаются только диалоги.
    Свои же ответы (from_id сообщества — отрицательный) пропускаем.
    """
    kind = payload.get("type", "")
    obj = payload.get("object") or {}
    group_id = str(payload.get("group_id", ""))

    if kind == "message_new":
        message = obj.get("message") or obj
        author_id = message.get("from_id")
        if not author_id or author_id < 0:
            return []
        return [SocialItem(
            network="vk",
            kind=KIND_MESSAGE,
            item_id=str(message.get("id", "")),
            author=_vk_author(payload, author_id),
            text=message.get("text", "") or "[вложение]",
            created_at=_ts(message.get("date")),
            thread_id=str(message.get("peer_id", author_id)),
            url=f"https://vk.com/gim{group_id}?sel={author_id}",
            raw=message,
        )]

    if kind in ("wall_reply_new", "photo_comment_new", "video_comment_new"):
        author_id = obj.get("from_id")
        if not author_id or author_id < 0:
            return []
        post_id = obj.get("post_id") or obj.get("photo_id") or obj.get("video_id", "")
        owner_id = obj.get("owner_id", f"-{group_id}")
        return [SocialItem(
            network="vk",
            kind=KIND_COMMENT,
            item_id=str(obj.get("id", "")),
            author=_vk_author(payload, author_id),
            text=obj.get("text", ""),
            created_at=_ts(obj.get("date")),
            thread_id=str(obj.get("id", "")),
            url=f"https://vk.com/wall{owner_id}_{post_id}",
            raw={"post_id": post_id, "owner_id": owner_id, **obj},
        )]

    return []


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
