#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — Финальная версия
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

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
HF_TOKEN = os.getenv("HF_TOKEN", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
WEBHOOK_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
PORT = int(os.getenv("PORT", 8080))

if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")

HF_MODELS = [
    "mistralai/Mistral-7B-Instruct-v0.2",
    "microsoft/Phi-3-mini-4k-instruct",
    "google/gemma-2b-it"
]
current_model_idx = 0

REGIONS = {
    "yunnan": "Юньнань (Пуэр)",
    "fujian": "Фуцзянь (Улуны)",
    "zhejiang": "Чжэцзян (Лунцзин)",
    "anhui": "Аньхой (Красный чай)",
    "sichuan": "Сычуань (Зелёный)",
    "hunan": "Хунань (Чёрный чай)"
}

CACHE_MAX_SIZE = 200
search_cache: dict = {}


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


async def ask_hf_robust(prompt: str) -> str:
    global current_model_idx

    if not HF_TOKEN:
        return "⚠️ AI отключён. Задайте HF_TOKEN в переменных окружения."

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

    for attempt in range(len(HF_MODELS)):
        model_idx = (current_model_idx + attempt) % len(HF_MODELS)
        model = HF_MODELS[model_idx]
        url = f"https://api-inference.huggingface.co/models/{model}"

        try:
            connector = TCPConnector(ttl_dns_cache=300, limit=10)
            async with ClientSession(
                connector=connector,
                connector_owner=True,
                timeout=aiohttp.ClientTimeout(total=45)
            ) as session:
                async with session.post(url, headers=headers, json=payload) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        if result and isinstance(result, list) and len(result) > 0:
                            text = result[0].get('generated_text', '').strip()
                            if text:
                                current_model_idx = model_idx
                                return text[:500]
                        logger.warning(f"Пустой ответ от {model}")
                        continue

                    elif resp.status == 503:
                        # Модель спит — читаем время ожидания из ответа
                        try:
                            body = await resp.json()
                            wait_time = min(float(body.get("estimated_time", 20)), 30)
                        except Exception:
                            wait_time = 20
                        logger.info(f"Модель {model} спит, ждём {wait_time:.0f}с...")
                        await asyncio.sleep(wait_time)
                        # Повторяем запрос к той же модели
                        try:
                            async with ClientSession(
                                timeout=aiohttp.ClientTimeout(total=45)
                            ) as s2:
                                async with s2.post(url, headers=headers, json=payload) as r2:
                                    if r2.status == 200:
                                        result = await r2.json()
                                        if result and isinstance(result, list):
                                            text = result[0].get('generated_text', '').strip()
                                            if text:
                                                current_model_idx = model_idx
                                                return text[:500]
                        except Exception:
                            pass
                        continue

                    elif resp.status == 429:
                        logger.warning(f"Rate limit на {model}, пробуем следующую")
                        await asyncio.sleep(2)
                        continue

                    elif resp.status == 401:
                        logger.error("❌ HF_TOKEN невалидный!")
                        return "⚠ Неверный HF токен. Проверьте переменную HF_TOKEN."

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
                    _clean_cache()
                    search_cache[cache_key] = (time.time(), result)
                    return result
    except Exception as e:
        logger.warning(f"Поиск не удался: {e}")

    return ""


async def safe_edit(msg, text: str, update: Update = None):
    try:
        await msg.edit_text(text)
    except Exception as e:
        logger.warning(f"edit_text не удался: {e}")
        if update:
            try:
                await update.message.reply_text(text)
            except Exception as e2:
                logger.error(f"Не удалось отправить сообщение: {e2}")


async def fast_reply(update: Update, text: str):
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


async def debug_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    lines = ["🔧 <b>Диагностика:</b>\n"]

    lines.append(f"🔑 HF_TOKEN: {'✅ задан' if HF_TOKEN else '❌ не задан'}")
    lines.append(f"🔑 SERPER_KEY: {'✅ задан' if SERPER_KEY else '⚠️ не задан'}\n")

    lines.append("🤖 <b>Модели HF:</b>")
    headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}
    payload = {
        "inputs": "<s>[INST] Скажи: ОК [/INST]",
        "parameters": {"max_new_tokens": 10, "return_full_text": False}
    }

    for model in HF_MODELS:
        url = f"https://api-inference.huggingface.co/models/{model}"
        try:
            async with ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
                async with s.post(url, headers=headers, json=payload) as r:
                    if r.status == 200:
                        lines.append(f"  ✅ {model.split('/')[1]}")
                    elif r.status == 503:
                        lines.append(f"  ⏳ {model.split('/')[1]} (спит, норм)")
                    elif r.status == 401:
                        lines.append(f"  🔐 {model.split('/')[1]} (неверный токен!)")
                    elif r.status == 429:
                        lines.append(f"  🚫 {model.split('/')[1]} (rate limit)")
                    else:
                        lines.append(f"  ❌ {model.split('/')[1]} (статус {r.status})")
        except asyncio.TimeoutError:
            lines.append(f"  ⏱ {model.split('/')[1]} (таймаут)")
        except Exception as e:
            lines.append(f"  💥 {model.split('/')[1]} ({str(e)[:40]})")

    lines.append("\n🔍 <b>Поиск Serper:</b>")
    if SERPER_KEY:
        try:
            async with ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as s:
                async with s.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": SERPER_KEY},
                    json={"q": "чай", "num": 1}
                ) as r:
                    lines.append(f"  {'✅ работает' if r.status == 200 else f'❌ статус {r.status}'}")
        except Exception as e:
            lines.append(f"  ❌ {str(e)[:50]}")
    else:
        lines.append("  ⚠️ ключ не задан")

    await update.message.reply_text("\n".join(lines), parse_mode='HTML')


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
            f"Инструкция по завариванию чая: температура, время, пропорции. Данные: {data}"
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
