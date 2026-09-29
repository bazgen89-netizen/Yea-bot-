"""Автоанонс новых статей блога waystea.ru в Telegram-канал и группу ВКонтакте.

Запускается по расписанию (GitHub Actions, см. .github/workflows/crosspost.yml):
берёт последние записи через WordPress REST API, отправляет анонс по тем, что
ещё не публиковались, и запоминает отправленные ID в JSON-файле состояния.

Площадка без настроенных ключей пропускается. При первом запуске для площадки
все уже существующие статьи помечаются как отправленные — старый архив не
публикуется, анонсируются только новые статьи.
"""
import html
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

SITE_URL = "https://waystea.ru"
POSTS_PER_RUN = 20
HTTP_TIMEOUT = 30
VK_API_VERSION = "5.199"
# Сайт отдаёт 403 на запросы без браузерного User-Agent
USER_AGENT = "Mozilla/5.0 (compatible; WaysteaCrosspost/1.0; +https://waystea.ru)"

TG_CAPTION_LIMIT = 1024
SUMMARY_MAX_LEN = 600


@dataclass(frozen=True)
class Post:
    id: int
    title: str
    link: str
    summary: str
    image_url: Optional[str] = None


@dataclass(frozen=True)
class CrosspostSettings:
    site_url: str
    telegram_bot_token: str
    telegram_channel_id: str
    vk_access_token: str
    vk_group_id: str
    state_path: str

    @classmethod
    def from_env(cls) -> "CrosspostSettings":
        return cls(
            site_url=os.getenv("WP_SITE_URL", SITE_URL).rstrip("/"),
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            telegram_channel_id=os.getenv("TELEGRAM_CHANNEL_ID", ""),
            vk_access_token=os.getenv("VK_ACCESS_TOKEN", ""),
            vk_group_id=os.getenv("VK_GROUP_ID", "").lstrip("-"),
            state_path=os.getenv("CROSSPOST_STATE", "crosspost_state.json"),
        )

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_channel_id)

    @property
    def vk_enabled(self) -> bool:
        return bool(self.vk_access_token and self.vk_group_id)


# ---------- Разбор записей WordPress ----------

def html_to_text(raw: str) -> str:
    text = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", "", raw)
    # Блочные теги и <br> разделяют слова, строчные (<b>, <em>, <a>) — нет
    text = re.sub(r"(?i)<(br|/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table))\b[^>]*>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(" ", 1)[0]
    return cut.rstrip(",.;:—- ") + "…"


def extract_summary(content_html: str, excerpt_html: str = "") -> str:
    """Абзац «Коротко: …» из статьи, иначе excerpt, иначе первый абзац."""
    for para in re.findall(r"(?s)<p[^>]*>(.*?)</p>", content_html):
        text = html_to_text(para)
        # Ровно «Коротко:», а не «Коротко в цифрах:» и подобные подзаголовки
        match = re.match(r"(?i)коротко\s*:\s*", text)
        if match:
            summary = text[match.end():]
            return truncate(summary[:1].upper() + summary[1:], SUMMARY_MAX_LEN)
    excerpt = html_to_text(excerpt_html)
    excerpt = re.sub(r"\s*(Читать далее.*)?$", "", excerpt)
    excerpt = re.sub(r"\s*\[?…\]?$", "", excerpt)
    if excerpt:
        return truncate(excerpt, SUMMARY_MAX_LEN)
    first = re.search(r"(?s)<p[^>]*>(.*?)</p>", content_html)
    return truncate(html_to_text(first.group(1)), SUMMARY_MAX_LEN) if first else ""


def parse_post(data: dict) -> Post:
    image_url = None
    media = data.get("_embedded", {}).get("wp:featuredmedia") or []
    if media and isinstance(media[0], dict):
        image_url = media[0].get("source_url")
    content_html = data.get("content", {}).get("rendered", "")
    if not image_url:
        # Нет обложки — берём первую картинку из текста статьи
        img = re.search(r'<img[^>]+src="([^"]+)"', content_html)
        image_url = img.group(1) if img else None
    return Post(
        id=int(data["id"]),
        title=html_to_text(data.get("title", {}).get("rendered", "")),
        link=data["link"],
        summary=extract_summary(content_html, data.get("excerpt", {}).get("rendered", "")),
        image_url=image_url,
    )


# ---------- Тексты анонсов ----------

def format_telegram(post: Post) -> str:
    title = html.escape(post.title)
    link = html.escape(post.link, quote=True)
    head = f"🍵 <b>{title}</b>\n\n"
    tail = f'\n\n👉 <a href="{link}">Читать статью на waystea.ru</a>'
    room = TG_CAPTION_LIMIT - len(head) - len(tail)
    return head + html.escape(truncate(post.summary, max(room, 0))) + tail


def format_vk(post: Post) -> str:
    return f"🍵 {post.title}\n\n{post.summary}\n\nЧитать полностью: {post.link}"


# ---------- Состояние ----------

def load_state(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_state(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2, sort_keys=True)


def pending_posts(posts: list, state: dict, platform: str) -> list:
    """Записи, которые ещё не публиковались на площадке (старые — первыми).

    Если площадка встречается впервые, все текущие записи помечаются
    отправленными, чтобы не выгрузить в канал весь архив блога.
    """
    if platform not in state:
        state[platform] = sorted(p.id for p in posts)
        logger.info(f"{platform}: первый запуск, {len(posts)} существующих статей пропущены")
        return []
    done = set(state[platform])
    return sorted((p for p in posts if p.id not in done), key=lambda p: p.id)


def mark_done(state: dict, platform: str, post_id: int) -> None:
    state[platform] = sorted(set(state[platform]) | {post_id})


# ---------- HTTP ----------

def _request(url: str, data: Optional[dict] = None) -> dict:
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return json.load(resp)


def fetch_posts(site_url: str) -> list:
    query = urllib.parse.urlencode({
        "per_page": POSTS_PER_RUN,
        "status": "publish",
        "_embed": "wp:featuredmedia",
        "_fields": "id,link,title,excerpt,content,_links,_embedded",
    })
    return [parse_post(item) for item in _request(f"{site_url}/wp-json/wp/v2/posts?{query}")]


def send_telegram(settings: CrosspostSettings, post: Post) -> None:
    api = f"https://api.telegram.org/bot{settings.telegram_bot_token}"
    text = format_telegram(post)
    if post.image_url:
        result = _request(f"{api}/sendPhoto", {
            "chat_id": settings.telegram_channel_id, "photo": post.image_url,
            "caption": text, "parse_mode": "HTML",
        })
    else:
        result = _request(f"{api}/sendMessage", {
            "chat_id": settings.telegram_channel_id, "text": text, "parse_mode": "HTML",
        })
    if not result.get("ok"):
        raise RuntimeError(f"Telegram: {result.get('description')}")


def send_vk(settings: CrosspostSettings, post: Post) -> None:
    result = _request("https://api.vk.com/method/wall.post", {
        "owner_id": f"-{settings.vk_group_id}",
        "from_group": 1,
        "message": format_vk(post),
        "attachments": post.link,
        "access_token": settings.vk_access_token,
        "v": VK_API_VERSION,
    })
    if "error" in result:
        raise RuntimeError(f"VK: {result['error'].get('error_msg')}")


# ---------- Запуск ----------

def run(settings: CrosspostSettings) -> int:
    """Возвращает число ошибок отправки (0 — всё хорошо)."""
    senders = []
    if settings.telegram_enabled:
        senders.append(("telegram", send_telegram))
    if settings.vk_enabled:
        senders.append(("vk", send_vk))
    if not senders:
        logger.warning("Ни одна площадка не настроена — задайте ключи Telegram и/или VK")
        return 0

    posts = fetch_posts(settings.site_url)
    state = load_state(settings.state_path)
    errors = 0
    for platform, send in senders:
        for post in pending_posts(posts, state, platform):
            try:
                send(settings, post)
                mark_done(state, platform, post.id)
                logger.info(f"{platform}: опубликовано «{post.title}»")
            except Exception as e:
                # Не помечаем отправленной — повторим при следующем запуске
                errors += 1
                logger.error(f"{platform}: не удалось опубликовать «{post.title}»: {e}")
    save_state(settings.state_path, state)
    return errors


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    errors = run(CrosspostSettings.from_env())
    raise SystemExit(1 if errors else 0)
