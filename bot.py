#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Waystea Tea Expert Bot — Расширенная версия (Регионы, Поставки, Цены)
"""
import os, asyncio, logging
from aiohttp import web
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# 🔑 НАСТРОЙКИ
# ==========================================
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "ВАШ_ТОКЕН_БОТА")
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
GEMINI_KEY = "AIzaSyDLg9eh-1SACLo3eHB-m0qEcFdLxYx6F0w"
GEMINI_MODEL = "gemini-1.5-flash"
SERPER_KEY = os.getenv("SERPER_KEY", "")

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ==========================================
#  КОНСТАНТЫ
# ==========================================
REGIONS = {
    "yunnan": "Юньнань (Пуэр, Красный чай)",
    "fujian": "Фуцзянь (Улуны, Белый чай)",
    "zhejiang": "Чжэцзян (Зелёный чай, Лунцзин)",
    "anhui": "Аньхой (Красный чай, Жёлтый чай)",
    "sichuan": "Сычуань (Зелёный, Цветочный чай)",
    "hunan": "Хунань (Чёрный чай, Анхуа)"
}

MODES = {
    "brew": "🫖 Как заваривать?",
    "news": "📰 Новости по регионам",
    "ship": "🚢 Поставки в Россию",
    "price": "💰 Поиск минимальной цены",
    "back": "🔙 Главное меню"
}

# ==========================================
# 🔍 ПОИСК (Оптимизирован под задачи)
# ==========================================
async def search_general(query: str) -> str:
    if not SERPER_KEY: return ""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.post("https://google.serper.dev/search", headers={"X-API-KEY": SERPER_KEY}, json={"q": f"{query} tea china", "num": 3, "hl": "ru"}) as r:
                if r.status == 200:
                    return "\n".join([f"• {i.get('title')}: {i.get('snippet')}" for i in (await r.json()).get("organic", [])[:3]])
    except: pass
    return ""

async def search_region_news(region_code: str) -> str:
    if not SERPER_KEY: return ""
    region_name = REGIONS.get(region_code, region_code)
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            q = f"чай {region_name} новости 2025 2026 урожай сбор site:tea.ru OR site:interfax.ru OR site:ria.ru"
            async with s.post("https://google.serper.dev/search", headers={"X-API-KEY": SERPER_KEY}, json={"q": q, "num": 3, "hl": "ru"}) as r:
                if r.status == 200:
                    return "\n".join([f"📌 {i.get('title')}\n🔗 {i.get('link')}\n💬 {i.get('snippet')}" for i in (await r.json()).get("organic", [])[:3]])
    except: pass
    return f"🔍 По региону {region_name} свежие новости не найдены в открытых источниках."

async def search_shipments() -> str:
    if not SERPER_KEY: return ""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            q = "поставки чая в Россию 2025 2026 импорт таможенная статистика крупнейшие поставщики"
            async with s.post("https://google.serper.dev/search", headers={"X-API-KEY": SERPER_KEY}, json={"q": q, "num": 4, "hl": "ru"}) as r:
                if r.status == 200:
                    return "\n".join([f"📦 {i.get('title')}\n🏢 {i.get('snippet')}" for i in (await r.json()).get("organic", [])[:4]])
    except: pass
    return "📊 Данные по поставкам временно недоступны. Попробуйте позже."

async def search_price(tea_name: str) -> str:
    if not SERPER_KEY: return ""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as s:
            q = f"купить {tea_name} цена минимальная Россия site:ozon.ru OR site:wildberries.ru OR site:avito.ru OR site:tea.ru"
            async with s.post("https://google.serper.dev/search", headers={"X-API-KEY": SERPER_KEY}, json={"q": q, "num": 3, "hl": "ru"}) as r:
                if r.status == 200:
                    return "\n".join([f"💸 {i.get('title')}\n💰 {i.get('snippet')}" for i in (await r.json()).get("organic", [])[:3]])
    except: pass
    return f"💡 Цены на {tea_name} в открытых источниках не найдены. Проверьте маркетплейсы напрямую."

# ==========================================
#  GEMINI API
# ==========================================
async def ask_gemini(prompt: str) -> str:
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_KEY}"
            payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1000}}
            async with s.post(url, json=payload) as r:
                if r.status == 200:
                    data = await r.json()
                    return data["candidates"][0]["content"]["parts"][0]["text"].strip()
                return f"⚠️ Ошибка Gemini: {r.status}"
    except Exception as e:
        return f"⚠️ Ошибка AI: {str(e)[:100]}"

# ==========================================
# 📱 ЛОГИКА БОТА
# ==========================================
async def send_message(update: Update, text: str, kb=None):
    await update.message.reply_text(text, reply_markup=kb, parse_mode='HTML')

async def show_main_menu(update: Update):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton(MODES["brew"], callback_data="brew"),
         InlineKeyboardButton(MODES["news"], callback_data="news")],
        [InlineKeyboardButton(MODES["ship"], callback_data="ship"),
         InlineKeyboardButton(MODES["price"], callback_data="price")]
    ])
    await send_message(update, "🍵 <b>Waystea Tea Expert</b>\n\nВыберите раздел:", kb)

async def show_regions(update: Update):
    kb = InlineKeyboardMarkup([[InlineKeyboardButton(name, callback_data=f"reg_{code}")] for code, name in REGIONS.items()])
    await send_message(update, "🌍 Выберите регион для новостей:", kb)

async def handle_brew(update: Update):
    await update.message.chat.send_action("typing")
    ctx = await search_general("как правильно заваривать китайский чай гайвань пропорции температура")
    prompt = f"Ты эксперт по чаю. Дай чёткую инструкцию по завариванию. Контекст: {ctx}"
    await update.message.reply_text(await ask_gemini(prompt) + "\n\n📖 Источник: поиск по китайским гайдам")

async def handle_shipments(update: Update):
    await update.message.chat.send_action("typing")
    data = await search_shipments()
    prompt = f"Ты аналитик рынка чая. Структурируй данные о поставках в РФ. Выдели ключевых поставщиков и объёмы. Данные: {data}"
    await update.message.reply_text(await ask_gemini(prompt) + "\n\n Данные из открытых источников и таможенных сводок")

async def handle_price_request(update: Update, tea_name: str):
    await update.message.chat.send_action("typing")
    data = await search_price(tea_name)
    prompt = f"Ты ценовой аналитик. Найди минимальную цену на {tea_name} в России. Укажи магазин, цену за грамм/упаковку и ссылку. Данные: {data}"
    await update.message.reply_text(await ask_gemini(prompt) + "\n\n💡 Цены актуальны на момент поиска. Проверяйте наличие на маркетплейсах.")

# ==========================================
# 🔄 ХЕНДЛЕРЫ
# ==========================================
async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    text = update.message.text.strip()
    mode = context.user_data.get("mode")

    # Если ждём название чая для цены
    if mode == "price_wait":
        context.user_data.pop("mode", None)
        await handle_price_request(update, text)
        return

    # Приветствие или /start
    if text.lower() in ["привет", "старт", "/start", "меню"]:
        context.user_data.clear()
        await show_main_menu(update)
        return

    # Обычный вопрос
    await update.message.chat.send_action("typing")
    ctx = await search_general(text)
    prompt = f"Ты эксперт по китайскому чаю. Ответь кратко и по делу. Контекст: {ctx}\nВопрос: {text}"
    await update.message.reply_text(await ask_gemini(prompt) + "\n\n🇨🇳 Источники: Китайские чайные порталы")

async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    msg = query.message

    if data == "brew":
        await msg.reply_text("⏳ Ищу лучшие практики заваривания...")
        await handle_brew(type('U', (), {'message': msg})())
    elif data == "news":
        await show_regions(type('U', (), {'message': msg})())
    elif data.startswith("reg_"):
        region = data.split("_")[1]
        await msg.reply_text(f"⏳ Ищу новости по региону {REGIONS[region]}...")
        news = await search_region_news(region)
        prompt = f"Сделай краткую сводку новостей о чае в этом регионе. Данные: {news}"
        await msg.reply_text(await ask_gemini(prompt) + "\n\n📰 Источник: региональные чайные новости")
    elif data == "ship":
        await msg.reply_text(" Загружаю данные по поставкам...")
        await handle_shipments(type('U', (), {'message': msg})())
    elif data == "price":
        context.user_data["mode"] = "price_wait"
        await msg.reply_text("💰 Напишите название чая (например: *Шу Пуэр Мэнхай 2015*), и я найду минимальную цену в России:")
    elif data == "back":
        context.user_data.clear()
        await show_main_menu(type('U', (), {'message': msg})())

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await show_main_menu(update)

# ==========================================
# 🚀 ЗАПУСК
# ==========================================
async def handle_webhook(request):
    try:
        upd = Update.de_json(await request.json(), request.app['bot'])
        await request.app['app'].process_update(upd)
        return web.Response(text="OK")
    except Exception as e:
        return web.Response(text="Error", status=500)

async def on_startup(app):
    await app['app'].initialize()
    await app['app'].start()
    await app['app'].bot.set_webhook(os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"))
    logger.info(f"✅ Bot started! @{app['app'].bot.username}")

async def on_shutdown(app):
    await app['app'].stop()
    await app['app'].shutdown()

def main():
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    application.add_handler(CallbackQueryHandler(on_callback))
    
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['app'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

