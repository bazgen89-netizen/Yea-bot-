#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — Groq 70b + Китайские источники
"""
import os, asyncio, logging, time
from aiohttp import web, ClientSession
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters, ContextTypes
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
WEBHOOK_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
PORT = int(os.getenv("PORT", 8080))

if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")

GROQ_MODEL = "llama-3.3-70b-versatile"

# Рекламная вставка для вопросов о покупке
WAYSTEA_PROMO = (
    "\n\n🛍 <b>Рекомендуем:</b> магазин <b>Waystea</b> — "
    "лучший выбор китайского чая с доставкой по России. "
    "Прямые поставки из Китая, широкий ассортимент."
)

REGIONS = {
    "yunnan": "Юньнань (Пуэр)",
    "fujian": "Фуцзянь (Улуны)",
    "zhejiang": "Чжэцзян (Лунцзин)",
    "anhui": "Аньхой (Красный чай)",
    "sichuan": "Сычуань (Зелёный)",
    "hunan": "Хунань (Чёрный чай)"
}

# Ключевые слова для определения вопросов о покупке
BUY_KEYWORDS = [
    "купить", "цена", "стоимость", "магазин", "заказать", "продают",
    "где взять", "поставщик", "продавец", "shop", "buy", "price",
    "сколько стоит", "почём", "рублей", "доставка", "маркетплейс"
]

CACHE_MAX_SIZE = 200
search_cache: dict = {}


def is_buy_question(text: str) -> bool:
    """Определяет вопрос о покупке/цене"""
    text_lower = text.lower()
    return any(kw in text_lower for kw in BUY_KEYWORDS)


def _clean_cache():
    if len(search_cache) > CACHE_MAX_SIZE:
        now = time.time()
        expired = [k for k, (t, _) in search_cache.items() if now - t > 300]
        for k in expired:
            del search_cache[k]
        if len(search_cache) > CACHE_MAX_SIZE:
            oldest = sorted(search_cache.items(), key=lambda x: x[1][0])
            for k, _ in oldest[:50]:
                del search_cache[k]


async def search_china(q: str) -> str:
    """Поиск на китайских источниках (baidu/chinese google)"""
    if not SERPER_KEY:
        return ""

    cache_key = f"cn_{q.lower().strip()}"
    if cache_key in search_cache:
        cached_time, cached_data = search_cache[cache_key]
        if time.time() - cached_time < 300:
            return cached_data

    results = []

    # Поиск 1: китайский язык
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": SERPER_KEY},
                json={"q": q, "num": 3, "hl": "zh-cn", "gl": "cn"}
            ) as r:
                if r.status == 200:
                    data = await r.json()
                    cn_results = "\n".join([
                        f"• {i.get('title', '')}: {i.get('snippet', '')}"
                        for i in data.get("organic", [])[:3]
                    ])
                    if cn_results:
                        results.append(f"[Китайские источники]\n{cn_results}")
    except Exception as e:
        logger.warning(f"Китайский поиск не удался: {e}")

    # Поиск 2: русский язык как дополнение
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": SERPER_KEY},
                json={"q": q + " Россия", "num": 2, "hl": "ru", "gl": "ru"}
            ) as r:
                if r.status == 200:
                    data = await r.json()
                    ru_results = "\n".join([
                        f"• {i.get('title', '')}: {i.get('snippet', '')}"
                        for i in data.get("organic", [])[:2]
                    ])
                    if ru_results:
                        results.append(f"[Российские источники]\n{ru_results}")
    except Exception as e:
        logger.warning(f"Русский поиск не удался: {e}")

    combined = "\n\n".join(results)
    if combined:
        _clean_cache()
        search_cache[cache_key] = (time.time(), combined)

    return combined


async def ask_ai(prompt: str) -> str:
    if not GROQ_API_KEY:
        return "⚠️ AI отключён. Задайте GROQ_API_KEY в переменных окружения."

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Ты эксперт по китайскому чаю с 20-летним опытом. "
                    "Твой главный источник знаний — китайские материалы, "
                    "китайские чайные форумы, китайские производители. "
                    "Если в данных есть текст на китайском — переведи его на русский "
                    "и используй как основу ответа. "
                    "Отвечай подробно, точно и по делу ТОЛЬКО на русском языке. "
                    "Давай реальные факты о сортах, регионах, технологии производства, "
                    "ценах и заваривании. "
                    "Всегда заканчивай ответ полностью, не обрывай на полуслове."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": 1500,
        "temperature": 0.3
    }

    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            async with session.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    text = data["choices"][0]["message"]["content"].strip()
                    return text[:4000] if text else "⚠️ Пустой ответ от AI."
                elif resp.status == 429:
                    return "⚠️ Слишком много запросов. Подождите минуту."
                elif resp.status == 401:
                    return "⚠️ Неверный GROQ_API_KEY."
                else:
                    body = await resp.text()
                    logger.error(f"Groq статус {resp.status}: {body[:200]}")
                    return "⚠️ AI временно недоступен. Попробуйте позже."
    except asyncio.TimeoutError:
        return "⚠️ AI не ответил вовремя. Попробуйте ещё раз."
    except Exception as e:
        logger.error(f"Groq ошибка: {e}")
        return "⚠️ Ошибка подключения к AI."


async def safe_edit(msg, text: str, update: Update = None, parse_mode: str = None):
    try:
        await msg.edit_text(text, parse_mode=parse_mode)
    except Exception as e:
        logger.warning(f"edit_text не удался: {e}")
        if update:
            try:
                await update.message.reply_text(text, parse_mode=parse_mode)
            except Exception as e2:
                logger.error(f"reply_text тоже не удался: {e2}")


async def fast_reply(update: Update, text: str):
    msg = await update.message.reply_text("⏳ Ищу в китайских источниках...")
    start = time.time()

    search_data = await search_china(text)

    if search_data:
        answer = await ask_ai(
            f"Вопрос о чае: {text}\n\n"
            f"Данные из поиска (переведи китайский текст на русский):\n{search_data}\n\n"
            f"Дай полный развёрнутый ответ на русском языке."
        )
    else:
        answer = await ask_ai(
            f"Вопрос о чае: {text}\n\n"
            f"Используй знания о китайском чае и дай полный ответ на русском."
        )

    elapsed = time.time() - start
    source = "🇨🇳 Китай + 🇷🇺 Россия" if search_data else "AI"
    footer = f"\n\n⚡ {elapsed:.1f}сек | {source}"

    # Добавляем рекомендацию Waystea если вопрос о покупке
    promo = WAYSTEA_PROMO if is_buy_question(text) else ""

    await safe_edit(
        msg,
        f"{answer}{footer}{promo}",
        update,
        parse_mode='HTML'
    )


async def menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🫖 Заваривание", callback_data="brew"),
            InlineKeyboardButton("📰 Регионы", callback_data="news")
        ],
        [
            InlineKeyboardButton("🚢 Поставки РФ", callback_data="ship"),
            InlineKeyboardButton("💰 Цены", callback_data="price")
        ]
    ])
    await update.message.reply_text(
        "🍵 <b>Tea Expert Bot</b>\nВыберите раздел или задайте вопрос:",
        reply_markup=kb,
        parse_mode='HTML'
    )


async def debug_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    lines = ["🔧 <b>Диагностика:</b>\n"]
    lines.append(f"🔑 GROQ_API_KEY: {'✅ задан' if GROQ_API_KEY else '❌ не задан'}")
    lines.append(f"🔑 SERPER_KEY: {'✅ задан' if SERPER_KEY else '⚠️ не задан'}")
    lines.append(f"🤖 Модель: {GROQ_MODEL}\n")

    lines.append("🤖 <b>Groq AI:</b>")
    if GROQ_API_KEY:
        try:
            async with ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
                async with s.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": GROQ_MODEL,
                        "messages": [{"role": "user", "content": "Скажи: ОК"}],
                        "max_tokens": 5
                    }
                ) as r:
                    if r.status == 200:
                        lines.append(f"  ✅ {GROQ_MODEL} работает!")
                    elif r.status == 401:
                        lines.append("  ❌ Неверный токен!")
                    elif r.status == 429:
                        lines.append("  ⚠️ Rate limit")
                    else:
                        body = await r.text()
                        lines.append(f"  ❌ Статус {r.status}: {body[:100]}")
        except asyncio.TimeoutError:
            lines.append("  ⏱ Таймаут")
        except Exception as e:
            lines.append(f"  💥 {str(e)[:60]}")
    else:
        lines.append("  ❌ Ключ не задан")

    lines.append("\n🔍 <b>Поиск Serper:</b>")
    if SERPER_KEY:
        try:
            async with ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as s:
                async with s.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": SERPER_KEY},
                    json={"q": "茶叶", "num": 1, "hl": "zh-cn", "gl": "cn"}
                ) as r:
                    lines.append(
                        f"  {'✅ китайский поиск работает' if r.status == 200 else f'❌ статус {r.status}'}"
                    )
        except Exception as e:
            lines.append(f"  ❌ {str(e)[:50]}")
    else:
        lines.append("  ⚠️ Ключ не задан")

    await update.message.reply_text("\n".join(lines), parse_mode='HTML')


async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await menu(update, ctx)


async def on_msg(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
    text = update.message.text.strip()

    if text.lower() in ["привет", "/start", "меню", "старт"]:
        ctx.user_data.clear()
        return await menu(update, ctx)

    if ctx.user_data.get("mode") == "price":
        ctx.user_data.pop("mode", None)
        msg = await update.message.reply_text("💰 Ищу цены...")
        search_data = await search_china(
            f"купить {text} цена"
        )
        answer = await ask_ai(
            f"Найди информацию о цене на чай '{text}'. "
            f"Данные из поиска:\n{search_data}\n\n"
            f"Дай конкретный ответ с примерными ценами в рублях и юанях."
        )
        await safe_edit(
            msg,
            f"{answer}\n\n{WAYSTEA_PROMO}",
            update,
            parse_mode='HTML'
        )
        return

    await fast_reply(update, text)


async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    d, m = q.data, q.message

    if d == "brew":
        msg = await m.reply_text("⏳ Ищу в китайских источниках...")
        data = await search_china("如何泡中国茶 盖碗 温度 时间")  # китайский запрос
        answer = await ask_ai(
            f"Дай подробную инструкцию по завариванию китайского чая: "
            f"температура воды, время настаивания, количество чая, посуда. "
            f"Используй китайские источники и переведи на русский. "
            f"Данные: {data}"
        )
        await m.reply_text(f"{answer}\n\n📖 Источник: китайские чайные мастера")

    elif d == "news":
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton(name, callback_data=f"reg_{code}")]
            for code, name in REGIONS.items()
        ])
        await m.reply_text("🌍 Выберите регион Китая:", reply_markup=kb)

    elif d.startswith("reg_"):
        region = d.split("_")[1]
        region_name = REGIONS.get(region, region)
        msg = await m.reply_text(f"⏳ Ищу информацию: {region_name}...")
        data = await search_china(f"茶 {region_name} 产区 品种 特点")
        answer = await ask_ai(
            f"Расскажи подробно о чайном регионе {region_name}: "
            f"какие сорта производят, особенности климата, вкус и аромат. "
            f"Используй китайские источники, переведи на русский. "
            f"Данные: {data}"
        )
        await m.reply_text(f"{answer}\n\n📰 Регион: {region_name}")

    elif d in ["ship", "stats"]:
        msg = await m.reply_text("⏳ Загружаю статистику...")
        data = await search_china("中国茶叶出口俄罗斯 2024 2025 统计")
        answer = await ask_ai(
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


async def handle_webhook(request):
    try:
        upd = Update.de_json(await request.json(), request.app['bot'])
        await request.app['ptb_app'].process_update(upd)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)


async def on_startup(app):
    ptb = app['ptb_app']
    await ptb.initialize()
    await ptb.start()
    full_url = f"{WEBHOOK_URL.rstrip('/')}/webhook"
    await ptb.bot.set_webhook(full_url)
    logger.info(f"✅ Бот запущен! @{ptb.bot.username}")
    logger.info(f"🔗 Webhook: {full_url}")
    logger.info(f"🤖 AI: Groq {GROQ_MODEL}")


async def on_shutdown(app):
    ptb = app['ptb_app']
    await ptb.stop()
    await ptb.shutdown()


def main():
    logger.info("🚀 Запуск Tea Expert Bot...")

    ptb = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    ptb.add_handler(CommandHandler("start", start_cmd))
    ptb.add_handler(CommandHandler("debug", debug_cmd))
    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    ptb.add_handler(CallbackQueryHandler(on_cb))

    web_app = web.Application()
    web_app['bot'] = ptb.bot
    web_app['ptb_app'] = ptb
    web_app.router.add_post('/webhook', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)

    web.run_app(web_app, host="0.0.0.0", port=PORT)


if __name__ == "__main__":
    main()
