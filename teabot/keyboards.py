"""Inline-клавиатуры бота."""
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

from .constants import REGIONS


def main_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🫖 Заваривание", callback_data="brew"),
            InlineKeyboardButton("📰 Регионы", callback_data="news")
        ],
        [
            InlineKeyboardButton("🚢 Поставки РФ", callback_data="ship"),
            InlineKeyboardButton("💰 Цены", callback_data="price")
        ],
        [
            InlineKeyboardButton("📍 Наши магазины", callback_data="stores")
        ]
    ])


def regions_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(name, callback_data=f"reg_{code}")]
        for code, name in REGIONS.items()
    ])
