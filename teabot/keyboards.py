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
        ]
    ])


def regions_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(name, callback_data=f"reg_{code}")]
        for code, name in REGIONS.items()
    ])


def social_panel_kb(autopilot: bool) -> InlineKeyboardMarkup:
    """Панель управления всеми соцсетями."""
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📥 Входящие", callback_data="soc:inbox"),
            InlineKeyboardButton("📊 Статус сетей", callback_data="soc:status"),
        ],
        [InlineKeyboardButton("✍️ Пост во все сети", callback_data="soc:post")],
        [InlineKeyboardButton(
            "🤖 Автопилот: ВКЛ ✅" if autopilot else "🤖 Автопилот: выкл",
            callback_data="soc:autopilot",
        )],
    ])


def social_item_kb(token: str, can_reply: bool) -> InlineKeyboardMarkup:
    """Кнопки под карточкой входящего сообщения или отзыва."""
    rows = []
    if can_reply:
        rows.append([
            InlineKeyboardButton("🤖 Ответить ИИ", callback_data=f"soc:ai:{token}"),
            InlineKeyboardButton("✍️ Свой ответ", callback_data=f"soc:re:{token}"),
        ])
    rows.append([InlineKeyboardButton("✅ Прочитано", callback_data=f"soc:done:{token}")])
    return InlineKeyboardMarkup(rows)


def social_draft_kb(token: str) -> InlineKeyboardMarkup:
    """Подтверждение черновика ответа, подготовленного ИИ."""
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("📨 Отправить", callback_data=f"soc:send:{token}"),
        InlineKeyboardButton("✍️ Переписать", callback_data=f"soc:re:{token}"),
    ]])


def social_post_kb() -> InlineKeyboardMarkup:
    """Подтверждение кросспостинга."""
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🚀 Опубликовать", callback_data="soc:post_go"),
        InlineKeyboardButton("❌ Отмена", callback_data="soc:post_cancel"),
    ]])
