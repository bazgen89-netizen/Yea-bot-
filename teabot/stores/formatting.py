"""Форматирование карточек и отзывов в HTML-разметку Telegram."""
from html import escape

from .models import PLATFORM_TITLES, Review, Store, StoreCard

REVIEW_TEXT_MAX_LEN = 400


def _stars(rating: float | None) -> str:
    if rating is None:
        return ""
    full = int(round(rating))
    return "★" * max(0, min(5, full))


def format_card(card: StoreCard) -> str:
    """Одна площадка одной точки."""
    title = PLATFORM_TITLES.get(card.platform, card.platform)
    if not card.ok:
        return f"  <b>{escape(title)}</b>: ⚠️ {escape(card.error or 'нет данных')}"

    head = f"  <b>{escape(title)}</b>"
    if card.rating is not None:
        count = f" ({card.reviews_count} отз.)" if card.reviews_count else ""
        head += f" — {card.rating:.1f} {_stars(card.rating)}{escape(count)}"
    lines = [head]
    if card.address:
        lines.append(f"    📍 {escape(card.address)}")
    if card.phone:
        lines.append(f"    📞 {escape(card.phone)}")
    if card.hours:
        lines.append(f"    🕘 {escape(card.hours)}")
    if card.url:
        lines.append(f"    🔗 <a href=\"{escape(card.url, quote=True)}\">открыть карточку</a>")
    if card.from_registry:
        lines.append("    <i>данные из реестра, площадка их по API не отдаёт</i>")
    return "\n".join(lines)


def format_store(store: Store, cards: list[StoreCard]) -> str:
    """Точка со всеми её карточками."""
    lines = [f"🏪 <b>{escape(store.title)}</b>"]
    if store.address:
        lines.append(f"<i>{escape(store.address)}</i>")
    lines.extend(format_card(c) for c in cards)
    return "\n".join(lines)


def format_stores(batches: list[tuple[Store, list[StoreCard]]]) -> str:
    if not batches:
        return (
            "📍 Список магазинов пуст.\n"
            "Добавьте точки в <code>stores.json</code> — см. docs/STORES.md."
        )
    return "\n\n".join(format_store(store, cards) for store, cards in batches)


def format_review(review: Review, store_title: str = "") -> str:
    """Один отзыв."""
    platform = PLATFORM_TITLES.get(review.platform, review.platform)
    head = f"💬 <b>{escape(platform)}</b>"
    if store_title:
        head += f" — {escape(store_title)}"
    if review.rating is not None:
        head += f"\n{_stars(review.rating)} {review.rating:.0f}/5"

    lines = [head]
    if review.author:
        lines.append(f"👤 {escape(review.author)}")
    if review.created_at:
        lines.append(f"🕒 {escape(review.created_at[:10])}")
    if review.text:
        text = review.text[:REVIEW_TEXT_MAX_LEN]
        if len(review.text) > REVIEW_TEXT_MAX_LEN:
            text += "…"
        lines.append(f"\n{escape(text)}")
    lines.append(
        "\n✅ <i>Ответ уже дан</i>" if review.answered else "\n⚠️ <i>Без ответа</i>"
    )
    if review.url:
        lines.append(f"🔗 <a href=\"{escape(review.url, quote=True)}\">карточка</a>")
    return "\n".join(lines)


def format_reviews(reviews: list[Review], titles: dict[str, str], limit: int = 5) -> str:
    if not reviews:
        return (
            "💬 Свежих отзывов не найдено.\n"
            "Тексты отзывов отдают 2ГИС и Google; Яндекс — только через кабинет "
            "Яндекс Бизнеса."
        )
    shown = reviews[:limit]
    body = "\n\n".join(format_review(r, titles.get(r.store_slug, "")) for r in shown)
    if len(reviews) > limit:
        body += f"\n\n<i>…и ещё {len(reviews) - limit}</i>"
    return body
