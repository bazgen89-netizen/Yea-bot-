#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — HuggingFace (БЕЗ Gemini)
"""
import os, asyncio, logging
from aiohttp import web, ClientSession
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
HF_TOKEN = os.getenv("HF_TOKEN", "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")
SERPER_KEY = os.getenv("SERPER_KEY", "")
WEBHOOK_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
PORT = int(os.getenv("PORT", 8080))

HF_MODEL = "mistralai/Mistral-7B-Instruct-v0.3"

REGIONS = {
    "yunnan": "Юньнань (Пуэр, Красный чай)",
    "fujian": "Фуцзянь (Улуны, Белый чай)",
    "zhejiang": "Чжэцзян (Зелёный чай, Лунцзин)",
    "anhui": "Аньхой (Красный чай, Жёлтый чай)",
    "sichuan": "Сычуань (Зелёный, Цветочный чай)",
    "hunan": "Хунань (Чёрный чай, Анхуа)"
}

async def ask_hf(prompt: str) -> str:
    if not HF_TOKEN or HF_TOKEN.startswith("hf_x"):
        return "⚠️ HF_TOKEN не настроен"
    headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}
    payload = {
        "inputs": f"<s>[INST] Ты эксперт по китайскому чаю. Отвечай кратко на русском с эмодзи 🍃. {prompt} [/INST]",
        "parameters": {"max_new_tokens": 800, "temperature": 0.3, "return_full_text": False}
    }
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as session:
            async with session.post(f"https://api-inference.huggingface.co/models/{HF_MODEL}", headers=headers, json=payload) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return result[0].get('generated_text', '').strip() if result else "Нет ответа"
                elif resp.status == 503:
                    return "⏳ Модель загружается. Попробуйте через 30 сек."
                else:
                    return f"⚠️ HF Error: {resp.status}"
    except Exception as e:
        return f"⚠️ Ошибка: {str(e)[:100]}"

async def search(q: str) -> str:
    if not SERPER_KEY: return ""
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.post("https://google.serper.dev/search", headers={"X-API-KEY": SERPER_KEY}, json={"q": q, "num": 3, "hl": "ru"}) as r:
                if r.status == 200:
                    return "\n".join([f"• {i.get('title')}: {i.get('snippet')}" for i in (await r.json()).get("organic", [])[:3]])
    except: pass
    return ""

async def menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🫖 Заваривание", callback_data="brew"), InlineKeyboardButton("📰 Регионы", callback_data="news")],
        [InlineKeyboardButton("🚢 Поставки РФ", callback_data="ship"), InlineKeyboardButton("💰 Цены", callback_data="price")]
    ])
    await update.message.reply_text("🍵 <b>Tea Expert Bot</b>\nВыберите раздел:", reply_markup=kb, parse_mode='HTML')

async def on_msg(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    text = update.message.text.strip()
    if text.lower() in ["привет", "/start", "меню"]:
        ctx.user_data.clear()
        return await menu(update, ctx)
    
    if ctx.user_data.get("mode") == "price":
        ctx.user_data.pop("mode", None)
        async with update.message.chat.action("typing"):
            data = await search(f"купить {text} цена Россия ozon wildberries")
            ans = await ask_hf(f"Найди минимальную цену на {text} в России. Данные: {data}")
            await update.message.reply_text(f"{ans}\n\n💡 Проверяйте актуальность на маркетплейсах")
        return

    async with update.message.chat.action("typing"):
        ctx_data = await search(f"{text} tea china")
        ans = await ask_hf(f"Ответь на вопрос о чае. Контекст: {ctx_data}\nВопрос: {text}")
        await update.message.reply_text(f"{ans}\n\n🇨 Источники: поиск")

async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    d, m = q.data, q.message
    
    if d == "brew":
        await m.reply_text("⏳ Ищу гайды по завариванию...")
        async with m.chat.action("typing"):
            data = await search("как заваривать китайский чай гайвань температура время")
            ans = await ask_hf(f"Дай инструкцию по завариванию чая в гайвани: температура, время, пропорции. Данные: {data}")
            await m.reply_text(f"{ans}\n\n📖 Источники: китайские гайды")
    elif d == "news":
        kb = InlineKeyboardMarkup([[InlineKeyboardButton(name, callback_data=f"reg_{code}")] for code, name in REGIONS.items()])
        await m.reply_text("🌍 Выберите регион:", reply_markup=kb)
    elif d.startswith("reg_"):
        region = d.split("_")[1]
        region_name = REGIONS.get(region, region)
        await m.reply_text(f"⏳ Ищу новости: {region_name}...")
        async with m.chat.action("typing"):
            news = await search(f"чай {region_name} новости 2025 2026")
            ans = await ask_hf(f"Сделай сводку новостей о чае из региона {region_name}. Данные: {news}")
            await m.reply_text(f"{ans}\n\n📰 Источник: региональные новости")
    elif d in ["ship", "stats"]:
        await m.reply_text("⏳ Загружаю статистику...")
        async with m.chat.action("typing"):
            data = await search("поставки чая в Россию 2025 импорт ФТС статистика тонны крупнейшие поставщики")
            ans = await ask_hf(f"Расскажи о поставках чая в Россию: объёмы в тоннах, крупнейшие импортёры, страны-поставщики. Данные: {data}")
            await m.reply_text(f"{ans}\n\n🏛️ Источник: ФТС / открытые данные")
    elif d == "price":
        ctx.user_data["mode"] = "price"
        await m.reply_text("💰 Напишите название чая (например: <i>Шу Пуэр Мэнхай 2015</i>):", parse_mode='HTML')

async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await menu(update, ctx)

async def handle_webhook(request):
    try:
        upd = Update.de_json(await request.json(), request.app['bot'])
        await request.app['app'].process_update(upd)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook err: {e}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    await app['app'].initialize()
    await app['app'].start()
    await app['app'].bot.set_webhook(WEBHOOK_URL)
    logger.info(f"✅ Bot running! @{app['app'].bot.username}")

async def on_shutdown(app):
    await app['app'].stop()
    await app['app'].shutdown()

def main():
    logger.info("🚀 Starting bot...")
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start_cmd))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    app.add_handler(CallbackQueryHandler(on_cb))
    
    web_app = web.Application()
    web_app['bot'], web_app['app'] = app.bot, app
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    web.run_app(web_app, host="0.0.0.0", port=PORT)

if __name__ == "__main__":
    main()

