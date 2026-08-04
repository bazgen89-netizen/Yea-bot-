"""Обработка нажатий на inline-кнопки меню."""
from telegram import Update
from telegram.ext import ContextTypes

from . import get_ai, get_search
from ..constants import REGIONS
from ..keyboards import regions_kb


async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    d, m = q.data, q.message
    search = get_search(ctx)
    ai = get_ai(ctx)

    if d == "stores":
        from .stores import show_stores
        await show_stores(m, ctx)

    elif d == "brew":
        await m.reply_text("⏳ Ищу в китайских источниках...")
        data = await search.search_china("如何泡中国茶 盖碗 温度 时间")  # китайский запрос
        answer = await ai.ask(
            f"Дай подробную инструкцию по завариванию китайского чая: "
            f"температура воды, время настаивания, количество чая, посуда. "
            f"Используй китайские источники и переведи на русский. "
            f"Данные: {data}"
        )
        await m.reply_text(f"{answer}\n\n📖 Источник: китайские чайные мастера")

    elif d == "news":
        await m.reply_text("🌍 Выберите регион Китая:", reply_markup=regions_kb())

    elif d.startswith("reg_"):
        region = d.split("_")[1]
        region_name = REGIONS.get(region, region)
        await m.reply_text(f"⏳ Ищу информацию: {region_name}...")
        data = await search.search_china(f"茶 {region_name} 产区 品种 特点")
        answer = await ai.ask(
            f"Расскажи подробно о чайном регионе {region_name}: "
            f"какие сорта производят, особенности климата, вкус и аромат. "
            f"Используй китайские источники, переведи на русский. "
            f"Данные: {data}"
        )
        await m.reply_text(f"{answer}\n\n📰 Регион: {region_name}")

    elif d in ["ship", "stats"]:
        await m.reply_text("⏳ Загружаю статистику...")
        data = await search.search_china("中国茶叶出口俄罗斯 2024 2025 统计")
        answer = await ai.ask(
            f"Расскажи о поставках чая из Китая в Россию: "
            f"объёмы, популярные сорта, тренды 2024-2025. "
            f"Используй китайские данные, переведи на русский. "
            f"Данные: {data}"
        )
        await m.reply_text(f"{answer}\n\n🏛️ Источник: китайская таможенная статистика")

    elif d == "price":
        ctx.user_data["mode"] = "price"
        await m.reply_text(
            f"💰 Напишите название чая для поиска цены:\n\n"
            f"💡 Также рекомендуем <b>Waystea</b> — прямые поставки из Китая",
            parse_mode='HTML'
        )
