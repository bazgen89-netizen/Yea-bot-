"""Inline-клавиатуры бота."""
from typing import Sequence, Set

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from .constants import REGIONS
from .social import title as network_title


def main_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🫖 Заваривание", callback_data="brew"),
            InlineKeyboardButton("📰 Регионы", callback_data="news")
        ],
        [
            InlineKeyboardButton("🚢 Поставки РФ", callback_data="ship"),
            InlineKeyboardButton("💰 Цены", callback_data="price")
        ]
    ])


def regions_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(name, callback_data=f"reg_{code}")]
        for code, name in REGIONS.items()
    ])


def social_kb(available: Sequence[str], selected: Set[str], has_media: bool) -> InlineKeyboardMarkup:
    """Экран кросспостинга: тумблеры сетей + действия над постом."""
    rows = [
        [InlineKeyboardButton(
            f"{'☑️' if code in selected else '▫️'} {network_title(code)}",
            callback_data=f"soc_net_{code}",
        )]
        for code in available
    ]
    rows.append([
        InlineKeyboardButton("✅ Все сети", callback_data="soc_all"),
        InlineKeyboardButton("🚫 Снять все", callback_data="soc_none"),
    ])
    rows.append([InlineKeyboardButton(
        "🖼 Заменить медиа" if has_media else "🖼 Добавить медиа",
        callback_data="soc_media",
    )])
    rows.append([
        InlineKeyboardButton("🚀 Опубликовать", callback_data="soc_send"),
        InlineKeyboardButton("📝 В черновики", callback_data="soc_draft"),
    ])
    rows.append([InlineKeyboardButton("❌ Отмена", callback_data="soc_cancel")])
    return InlineKeyboardMarkup(rows)
