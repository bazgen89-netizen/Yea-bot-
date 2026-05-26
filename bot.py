#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — Исправленная версия
"""
import os, asyncio, logging, time
from aiohttp import web, ClientSession, TCPConnector
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters, ContextTypes
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ✅ ИСПРАВЛЕНИЕ #7: убран хардкод токена — только из env
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
HF_TOKEN = os.getenv("HF_TOKEN", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
WEBHOOK_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
PORT = int(os.getenv("PORT", 8080))

# ✅ ИСПРАВЛЕНИЕ #8: проверка обязательных переменных при старте
if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")

HF_MODELS = [
    "mistralai/Mistral-7B-Instruct-v0.2",
    "microsoft/Phi-3-mini-4k-instruct",
    "google/gemma-2b-it"
]

# ✅ ИСПРАВЛЕНИЕ #2: индекс теперь хранит последнюю РАБОЧУЮ модель
current_model_idx = 0

REGIONS = {
    "yunnan": "Юньнань (Пуэр)",
    "fujian": "Фуцзянь (Улуны)",
    "zhejiang": "Чжэцзян (Лунцзин)",
    "anhui": "Аньхой (Красный чай)",
    "sichuan": "Сычуань (Зелёный)",
    "hunan": "Хунань (Чёрный чай)"
}

# ✅ ИСПРАВЛЕНИЕ #6: кэш с ограничением размера
CACHE_MAX_SIZE = 200
search_cache: dict = {}


def _clean_cache():
    """Удаляем старые записи если кэш переполнен"""
    if len(search_cache) > CACHE_MAX_SIZE:
        now = time.time()
        # Удаляем записи старше 5 минут
        expired = [k for k, (t, _) in search_cache.items() if now - t > 300]
        for k in expired:
            del search_cache[k]
        # Если всё ещё много — удаляем самые старые
        if len(search_cache) > CACHE_MAX_SIZE:
            oldest = sorted(search_cache.items(), key=lambda x: x[1][0])
            for k, _ in oldest[:50]:
                del search_cache[k]


async def ask_hf_robust(prompt: str) -> str:
    """Запрос к HF с повторными попытками и сменой модели"""
    global current_model_idx

    if not HF_TOKEN:
        return "⚠️ AI отключён. Настройте HF_TOKEN в переменных окружения."

    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "inputs": f"<s>[INST] Ты эксперт по чаю. Отвечай коротко на русском. {prompt} [/INST]",
        "parameters": {
            "max_new_tokens": 400,
            "temperature": 0.3,
            "return_full_text": False
        }
    }

    # ✅ ИСПРАВЛЕНИЕ #1: коннектор создаётся один раз, закрывается через async with
    # ✅ ИСПРАВЛЕНИЕ #2: перебираем модели начиная с последней рабочей
    for attempt in range(len(HF_MODELS)):
        model_idx = (current_model_idx + attempt) % len(HF_MODELS)
        model = HF_MODELS[model_idx]
        url = f"https://api-inference.huggingface.co/models/{model}"

        try:
            connector = TCPConnector(ttl_dns_cache=300, limit=10)
            async with ClientSession(
                connector=connector,
                connector_owner=True,  # сессия закрывает коннектор
                timeout=aiohttp.ClientTimeout(total=35)
            ) as session:
                async with session.post(url, headers=headers, json=payload) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        # ✅ ИСПРАВЛЕНИЕ #5: проверяем что текст не пустой
                        if result and isinstance(result, list) and len(result) > 0:
                            text = result[0].get('generated_text', '').strip()
                            if text:
                                current_model_idx = model_idx  # запоминаем рабочую модель
                                return text[:500]
                        logger.warning(f"Пустой ответ от {model}")
                        continue

                    elif resp.status == 503:
                        logger.info(f"Модель {model} загружается, ждём...")
                        await asyncio.sleep(3)
                        continue

                    elif resp.status == 429:
                        logger.warning(f"Rate limit на {model}, пробуем следующую")
                        continue

                    else:
                        logger.warning(f"Статус {resp.status} от {model}")
                        continue

        except asyncio.TimeoutError:
            logger.warning(f"Timeout для модели {model}")
            continue
        except Exception as e:
            logger.warning(f"Модель {model} недоступна: {e}")
            continue

    return "⚠️ AI временно недоступен. Попробуйте через минуту."


async def search_fast(q: str) -> str:
    """Поиск с кэшем"""
    if not SERPER_KEY:
        return ""

    cache_key = q.lower().strip()
    if cache_key in search_cache:
        cached_time, cached_data = search_cache[cache_key]
        if time.time() - cached_time < 300:
            return cached_data

    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": SERPER_KEY},
                json={"q": q, "num": 2, "hl": "ru"}
            ) as r:
                if r.status == 200:
                    data = await r.json()
                    result = "\n".join([
                        f"• {i.get('title', '')}"
                        for i in data.get("organic", [])[:2]
                    ])
                    _clean_cache()  # ✅ ИСПРАВЛЕНИЕ #6: чистим перед записью
                    search_cache[cache_key] = (time.time(), result)
                    return result
    except Exception as e:
        logger.warning(f"Поиск не удался: {e}")

    return ""


async def safe_edit(msg, text: str, update: Update = None):
    """✅ ИСПРАВЛЕНИЕ #4: безопасное редактирование сообщения"""
    try:
        await msg.edit_text(text)
    except Exception as e:
        logger.warning(f"edit_text не удался: {e}")
        # Если не удалось отредактировать — отправляем новым сообщением
        if update:
            try:
                await update.message.reply_text(text)
            except Exception as e2:
                logger.error(f"Не удалось отправить сообщение: {e2}")


async def fast_reply(update: Update, text: str):
    """Быстрый ответ с индикатором"""
    msg = await update.message.reply_text("⏳ Ищу...")
    start = time.time()

    search_data = await search_fast(text)

    if search_data:
        answer = await ask_hf_robust(f"Вопрос: {text}\nКонтекст: {search_data}")
    else:
        answer = await ask_hf_robust(f"Ответь на вопрос о чае: {text}")

    elapsed = time.time() - start
    source = "поиск + AI" if search_data else "AI"
    footer = f"\n\n⚡ {elapsed:.1f}сек | {source}"

    await safe_edit(msg, f"{answer}{footer}", update)


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
        "🍵 <b>Tea Expert Bot</b>\nВыберите раздел:",
        reply_markup=kb,
        parse_mode='HTML'
    )


async def on_msg(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
    text = update.message.text.strip()

    if text.lower() in ["привет", "/start", "меню"]:
        ctx.user_data.clear()
        return await menu(update, ctx)

    if ctx.user_data.get("mode") == "price":
        ctx.user_data.pop("mode", None)
        msg = await update.message.reply_text("💰 Ищу цены...")
        search_data = await search_fast(
            f"купить {text} цена Россия ozon wildberries avito"
        )
        answer = await ask_hf_robust(
            f"Найди минимальную цену на {text} в России. Данные: {search_data}"
        )
        await safe_edit(msg, f"{answer}\n\n💡 Проверяйте на маркетплейсах", update)
        return

    await fast_reply(update, text)


async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    d, m = q.data, q.message

    if d == "brew":
        msg = await m.reply_text("⏳ Готовлю инструкцию...")
        data = await search_fast("как заваривать китайский чай гайвань температура время")
        answer = await ask_hf_robust(
            f"Инструкция по завариванию: температура, время, пропорции. Данные: {data}"
        )
        await safe_edit(msg, f"{answer}\n\n📖 Китайские гайды")

    elif d == "news":
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton(name, callback_data=f"reg_{code}")]
            for code, name in REGIONS.items()
        ])
        await m.reply_text("🌍 Выберите регион:", reply_markup=kb)

    elif d.startswith("reg_"):
        region = d.split("_")[1]
        region_name = REGIONS.get(region, region)
        msg = await m.reply_text(f"⏳ Новости: {region_name}...")
        data = await search_fast(f"чай {region_name} новости урожай 2025 2026")
        answer = await ask_hf_robust(
            f"Новости чая из {region_name}. Данные: {data}"
        )
        await safe_edit(msg, f"{answer}\n\n📰 Региональные источники")

    elif d in ["ship", "stats"]:
        msg = await m.reply_text("⏳ Статистика...")
        data = await search_fast("поставки чая в Россию 2025 импорт ФТС тонны")
        answer = await ask_hf_robust(
            f"Статистика импорта чая в РФ. Данные: {data}"
        )
        await safe_edit(msg, f"{answer}\n\n🏛️ ФТС / Открытые данные")

    elif d == "price":
        ctx.user_data["mode"] = "price"
        await m.reply_text("💰 Напишите название чая:")


async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await menu(update, ctx)


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

    # ✅ ИСПРАВЛЕНИЕ #3: webhook указывает на конкретный путь /webhook
    webhook_path = "/webhook"
    full_url = f"{WEBHOOK_URL.rstrip('/')}{webhook_path}"
    await ptb.bot.set_webhook(full_url)
    logger.info(f"✅ Бот запущен! @{ptb.bot.username}")
    logger.info(f"🔗 Webhook: {full_url}")
    logger.info(f"🤖 HF модели: {[m.split('/')[1] for m in HF_MODELS]}")


async def on_shutdown(app):
    ptb = app['ptb_app']
    await ptb.stop()
    await ptb.shutdown()


def main():
    logger.info("🚀 Запуск бота...")

    ptb = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    ptb.add_handler(CommandHandler("start", start_cmd))
    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    ptb.add_handler(CallbackQueryHandler(on_cb))

    web_app = web.Application()
    web_app['bot'] = ptb.bot
    web_app['ptb_app'] = ptb  # ✅ Переименовано: 'app' конфликтовало с aiohttp app

    # ✅ ИСПРАВЛЕНИЕ #3: маршрут совпадает с webhook URL
    web_app.router.add_post('/webhook', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)

    web.run_app(web_app, host="0.0.0.0", port=PORT)


if __name__ == "__main__":
    main()
