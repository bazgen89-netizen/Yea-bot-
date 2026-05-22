#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — Эксперт по китайскому чаю (Gemini + Serper)
"""
import os, sys, asyncio, logging
from aiohttp import web
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    filters, ContextTypes
)
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
YOUR_TELEGRAM_ID = int(os.getenv("YOUR_TELEGRAM_ID", "0") or "0")
GEMINI_KEY = os.getenv("GEMINI_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "gemini-1.5-flash"

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

search_cache = {}
GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "доброе утро", "добрый вечер", "приветствую", "хелло", "hello", "hi", "йо", "здарова", "прив"]

# ---------------------------------------------------------
# 🟢 ПРИВЕТСТВИЕ
# ---------------------------------------------------------
async def handle_greeting(update: Update, user_text: str) -> bool:
    text_lower = user_text.strip().lower()
    if any(greet in text_lower for greet in GREETINGS):
        keyboard = [
            [InlineKeyboardButton("🫖 Как заваривать?", callback_data="brewing")],
            [InlineKeyboardButton("🎯 Подобрать чай", callback_data="selection")],
            [InlineKeyboardButton("💾 Хранение чая", callback_data="storage")],
            [InlineKeyboardButton("🏔️ История и легенды", callback_data="history")],
        ]
        await update.message.reply_text(
            "🍵 Здравствуйте! Я — эксперт по китайскому чаю.\n\n"
            "Выберите тему или просто напишите свой вопрос:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return True
    return False

# ---------------------------------------------------------
# 🔍 ПОИСК
# ---------------------------------------------------------
async def search_chinese_tea_sources(query: str) -> str:
    cache_key = query.lower().strip()
    if cache_key in search_cache:
        return search_cache[cache_key]

    if not SERPER_KEY:
        return "⚠️ Поиск временно недоступен."

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            search_queries = [
                f"{query} site:chinadaily.com.cn OR site:xinhuanet.com OR site:tea.cn",
                f"{query} chinese tea origin processing",
                f"{query} чай Китай заваривание"
            ]
            all_context = ""
            seen_urls = set()
            for q in search_queries:
                data = {"q": q, "num": 3, "hl": "ru"}
                try:
                    async with session.post("https://google.serper.dev/search", headers=headers, json=data) as resp:
                        if resp.status == 200:
                            result = await resp.json()
                            for item in result.get("organic", [])[:2]:
                                url = item.get('link', '')
                                if url not in seen_urls:
                                    seen_urls.add(url)
                                    all_context += f"📌 {item.get('title')}\n🔗 {url}\n📄 {item.get('snippet')}\n\n"
                except Exception as e:
                    logger.warning(f"Search failed: {e}")
                    continue
    except Exception as e:
        logger.error(f"Search error: {e}")
        all_context = ""

    result = all_context if all_context else "Информация не найдена. Отвечу на основе знаний."
    search_cache[cache_key] = result
    return result

# ---------------------------------------------------------
# 🤖 GEMINI API
# ---------------------------------------------------------
async def ask_gemini_expert(system_prompt: str, user_message: str, context: str) -> str:
    if not GEMINI_KEY:
        return "⚠️ Ошибка: не настроен ключ Gemini."

    full_prompt = f"""{system_prompt}

КОНТЕКСТ:
{context}

ВОПРОС: {user_message}

Отвечай кратко (3-5 абзацев), используй эмодзи 🍃🌡️️, давай точные цифры. Язык: русский."""

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as session:
            payload = {
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {
                    "temperature": 0.25,
                    "topK": 30,
                    "topP": 0.9,
                    "maxOutputTokens": 900,
                }
            }
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={GEMINI_KEY}"
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    res = await resp.json()
                    candidates = res.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts:
                            return parts[0].get("text", "").strip()
                else:
                    logger.error(f"Gemini error: {resp.status}")
                    
        return "⚠️ Временно не могу связаться с базой знаний.\n\n💡 Базовые советы:\n• Вода: 75-80°C для зелёного, 90-95°C для пуэра\n• Пропорция: 5-7 г на 100-150 мл\n• Храните чай в сухом месте без запахов"
    except Exception as e:
        logger.error(f"Gemini failed: {e}")
        return "⚠️ Ошибка соединения. Попробуйте позже."

# ---------------------------------------------------------
# 🧠 ПРОМПТЫ И КЛАССИФИКАЦИЯ
# ---------------------------------------------------------
def get_system_prompt(category: str) -> str:
    base = "Ты эксперт по китайскому чаю. Отвечай точно, доступно, с эмодзи. Указывай регион."
    prompts = {
        "brewing": base + " Фокус: температура, время проливов, пропорции, посуда.",
        "storage": base + " Фокус: влажность, температура, хранение шен/шу пуэра.",
        "selection": base + " Фокус: вкус, эффект, бюджет. Предлагай 2-3 варианта.",
        "history": base + " Фокус: регион, династия, легенды, технология.",
        "general": base
    }
    return prompts.get(category, prompts["general"])

# ---------------------------------------------------------
# 📩 ОБРАБОТКА СООБЩЕНИЙ
# ---------------------------------------------------------
async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text.strip()
    if await handle_greeting(update, user_text):
        return

    await process_query(update.message, user_text, "general")

async def process_query(message, user_text: str, category: str):
    """Универсальная обработка запроса"""
    async with message.chat.action("typing"):
        if category == "general":
            category = await classify_question(user_text)
        
        search_context = await search_chinese_tea_sources(user_text)
        system_prompt = get_system_prompt(category)
        answer = await ask_gemini_expert(system_prompt, user_text, search_context)

    footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ на основе китайских источников 🇨🇳🍃"
    full_answer = (answer + footer).strip()

    for i in range(0, len(full_answer), 4000):
        await message.reply_text(full_answer[i:i+4000])

# ---------------------------------------------------------
# 🔘 ОБРАБОТКА КНОПОК (ИСПРАВЛЕНО!)
# ---------------------------------------------------------
async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка нажатий на inline-кнопки"""
    query = update.callback_query
    if query is None:
        return
    
    # Обязательно подтверждаем callback!
    await query.answer()
    
    category = query.data
    logger.info(f"Button pressed: {category}")
    
    # Тексты для кнопок
    prompts = {
        "brewing": "Как правильно заваривать китайский чай?",
        "selection": "Помоги выбрать чай под мой вкус",
        "storage": "Как правильно хранить чай дома?",
        "history": "Расскажи историю китайского чая"
    }
    
    user_text = prompts.get(category, "Расскажи о чае")
    
    # Отправляем сообщение с индикатором
    if query.message:
        await process_query(query.message, user_text, category)

# ---------------------------------------------------------
# 📜 КОМАНДЫ
# ---------------------------------------------------------
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🫖 Заваривание", callback_data="brewing")],
        [InlineKeyboardButton("🎯 Подбор чая", callback_data="selection")],
        [InlineKeyboardButton("💾 Хранение", callback_data="storage")],
        [InlineKeyboardButton("🏔️ История", callback_data="history")]
    ]
    await update.message.reply_text(
        "🍵 <b>Waystea Tea Expert</b>\n\n"
        "Я — эксперт по китайскому чаю.\n\n"
        "Выберите тему или напишите вопрос!",
        reply_markup=InlineKeyboardMarkup(keyboard), parse_mode='HTML'
    )

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 Примеры:\n"
        "• Как заваривать шен пуэр?\n"
        "• Чем отличается шу от шен?\n"
        "• Как хранить пуэр?\n"
        "• Какой улун самый ароматный?", parse_mode='HTML'
    )

async def classify_question(user_text: str) -> str:
    t = user_text.lower()
    if any(w in t for w in ["заваривать", "температура", "пролив", "гайвань", "вода"]):
        return "brewing"
    if any(w in t for w in ["хранить", "хранение", "влажность"]):
        return "storage"
    if any(w in t for w in ["выбрать", "подобрать", "рекомендуй", "совет"]):
        return "selection"
    if any(w in t for w in ["история", "происхождение", "легенда"]):
        return "history"
    return "general"

# ---------------------------------------------------------
# 🌐 WEBHOOK
# ---------------------------------------------------------
async def handle_webhook(request):
    try:
        update = Update.de_json(await request.json(), request.app['bot'])
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    application = app['application']
    await application.initialize()
    await application.start()
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await application.bot.set_webhook(webhook_url)
    logger.info("✅ Bot запущен!")

async def on_shutdown(app):
    application = app['application']
    await application.stop()
    await application.shutdown()

def main():
    logger.info("🚀 Запуск бота...")
    
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_user_message))
    # ИСПРАВЛЕНО: добавлен pattern для надёжности
    application.add_handler(CallbackQueryHandler(button_callback, pattern=r'^(brewing|selection|storage|history)$'))
    
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['application'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

