#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — Эксперт по китайскому чаю
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

# ==========================================
# 🔑 НАСТРОЙКИ
# ==========================================
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
YOUR_TELEGRAM_ID = int(os.getenv("YOUR_TELEGRAM_ID", "0"))

# ✅ Ваш ключ Gemini вставлен
GEMINI_KEY = "AIzaSyAVwIKqdiK05-3AmYLRflYsRue3hm2t1kg"
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "gemini-1.5-flash"

# ==========================================
#  ЛОГИРОВАНИЕ
# ==========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# ==========================================
# 🧠 КЭШ И КОНСТАНТЫ
# ==========================================
search_cache = {}
GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "доброе утро", "добрый вечер", "приветствую", "хелло", "hello", "hi", "йо", "здарова"]

# ==========================================
# 🔍 ПОИСК (Китайские источники)
# ==========================================
async def search_chinese_tea_sources(query: str) -> str:
    cache_key = query.lower().strip()
    if cache_key in search_cache:
        return search_cache[cache_key]

    if not SERPER_KEY:
        return "⚠️ Поиск временно недоступен (нет ключа Serper)."

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            queries = [
                f"{query} site:chinadaily.com.cn OR site:xinhuanet.com OR site:tea.cn",
                f"{query} chinese tea origin processing tradition",
                f"{query} чай Китай заваривание хранение"
            ]
            context = ""
            seen = set()
            for q in queries:
                try:
                    async with session.post("https://google.serper.dev/search", headers=headers, json={"q": q, "num": 3, "hl": "ru"}) as resp:
                        if resp.status == 200:
                            res = await resp.json()
                            for item in res.get("organic", [])[:2]:
                                url = item.get("link", "")
                                if url not in seen:
                                    seen.add(url)
                                    context += f"📌 {item.get('title')}\n🔗 {url}\n📄 {item.get('snippet')}\n\n"
                except Exception as e:
                    logger.warning(f"Search skip: {e}")
                    continue
    except Exception as e:
        logger.error(f"Search network error: {e}")
        context = ""

    result = context if context else "Информация из источников не найдена. Отвечу на основе экспертных знаний."
    search_cache[cache_key] = result
    return result

# ==========================================
# 🤖 GEMINI API
# ==========================================
async def ask_gemini_expert(system_prompt: str, user_msg: str, context: str) -> str:
    if not GEMINI_KEY:
        return "⚠️ Ошибка: ключ Gemini не настроен."

    full_prompt = f"""{system_prompt}

КОНТЕКСТ ИЗ ИСТОЧНИКОВ:
{context}

ВОПРОС: {user_msg}

ПРАВИЛА ОТВЕТА:
• Кратко: 3-5 абзацев максимум
• Структурируй: используй эмодзи 🍃🌡️⏱️
• Давай точные цифры (температура, время, граммы)
• Если в контексте нет данных — честно скажи, но дай полезный ответ
• Язык: простой русский, без воды"""

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as session:
            payload = {
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {
                    "temperature": 0.25,
                    "topK": 30,
                    "topP": 0.9,
                    "maxOutputTokens": 1000,
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
                    err = await resp.text()
                    logger.error(f"Gemini API error {resp.status}: {err}")
                    
        return "⚠️ Временно не могу связаться с базой знаний.\n\n💡 Базовые советы:\n• Вода: 75-80°C для зелёного/белого, 90-95°C для улуна/пуэра\n• Пропорция: 5-7 г на 100-150 мл\n• Храните чай в сухом месте"
    except Exception as e:
        logger.error(f"Gemini request failed: {e}")
        return "⚠️ Ошибка соединения с AI. Попробуйте позже."

# ==========================================
# 🧠 ПРОМПТЫ И КЛАССИФИКАЦИЯ
# ==========================================
def get_system_prompt(category: str) -> str:
    base = "Ты — эксперт по китайскому чаю. Знаешь традиции, регионы, обработку и заваривание. Отвечай точно, доступно."
    prompts = {
        "brewing": base + " Фокус: температура воды, время проливов, пропорции, тип посуды.",
        "storage": base + " Фокус: влажность, температура, вентиляция, хранение шен/шу пуэра.",
        "selection": base + " Фокус: вкус, эффект, бюджет. Предлагай 2-3 варианта.",
        "history": base + " Фокус: регион, династия, легенды, технология производства.",
        "general": base + " Отвечай как универсальный эксперт."
    }
    return prompts.get(category, prompts["general"])

def classify_question(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["заваривать", "температура", "пролив", "гайвань", "вода", "горько"]): return "brewing"
    if any(w in t for w in ["хранить", "хранение", "влажность", "плесень", "старение"]): return "storage"
    if any(w in t for w in ["выбрать", "подобрать", "рекомендуй", "совет", "какой лучше", "купить"]): return "selection"
    if any(w in t for w in ["история", "происхождение", "легенда", "традиция", "откуда"]): return "history"
    return "general"

# ==========================================
# 📩 УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК
# ==========================================
async def process_query(message, user_text: str, category: str):
    async with message.chat.action("typing"):
        if category == "general":
            category = classify_question(user_text)
        
        context = await search_chinese_tea_sources(user_text)
        prompt = get_system_prompt(category)
        answer = await ask_gemini_expert(prompt, user_text, context)

    footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ на основе китайских источников 🇨🍃"
    full = (answer + footer).strip()
    
    for i in range(0, len(full), 4000):
        await message.reply_text(full[i:i+4000])

# ==========================================
# 📱 ХЕНДЛЕРЫ TELEGRAM
# ==========================================
async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
        
    text = update.message.text.strip()
    if any(g in text.lower() for g in GREETINGS):
        keyboard = [
            [InlineKeyboardButton("🫖 Как заваривать?", callback_data="brewing")],
            [InlineKeyboardButton("🎯 Подобрать чай", callback_data="selection")],
            [InlineKeyboardButton("💾 Хранение чая", callback_data="storage")],
            [InlineKeyboardButton("🏔️ История и легенды", callback_data="history")]
        ]
        await update.message.reply_text(
            "🍵 Здравствуйте! Я — эксперт по китайскому чаю.\n\n"
            "Выберите тему или просто напишите свой вопрос:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return
        
    await process_query(update.message, text, "general")

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not query:
        return
        
    await query.answer()
    category = query.data
    
    prompts = {
        "brewing": "Как правильно заваривать китайский чай?",
        "selection": "Помоги выбрать чай под мой вкус",
        "storage": "Как правильно хранить чай дома?",
        "history": "Расскажи историю китайского чая"
    }
    
    user_text = prompts.get(category, "Расскажи о чае")
    if query.message:
        await process_query(query.message, user_text, category)

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🫖 Заваривание", callback_data="brewing")],
        [InlineKeyboardButton("🎯 Подбор чая", callback_data="selection")],
        [InlineKeyboardButton("💾 Хранение", callback_data="storage")],
        [InlineKeyboardButton("🏔️ История", callback_data="history")]
    ]
    await update.message.reply_text(
        "🍵 <b>Waystea Tea Expert</b>\n\n"
        "Я — ваш персональный эксперт по <b>китайскому чаю</b>.\n\n"
        "• 📚 Рассказать о любом чае\n• 🫖 Научить заваривать\n"
        "• 💾 Подсказать хранение • 🎯 Помочь выбрать\n• 🏔️ История и происхождение\n\n"
        "Выберите тему или напишите вопрос!",
        reply_markup=InlineKeyboardMarkup(keyboard), parse_mode='HTML'
    )

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 <b>Примеры вопросов:</b>\n\n"
        "🔸 Как заваривать шен пуэр?\n"
        "🔸 Чем отличается шу от шен?\n"
        "🔸 Как хранить пуэр дома?\n"
        "🔸 Какой улун самый ароматный?\n"
        "🔸 Что такое Да Хун Пао?", parse_mode='HTML'
    )

# ==========================================
# 🌐 WEBHOOK & ЗАПУСК
# ==========================================
async def handle_webhook(request):
    try:
        update = Update.de_json(await request.json(), request.app['bot'])
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    app_instance = app['application']
    await app_instance.initialize()
    await app_instance.start()
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await app_instance.bot.set_webhook(webhook_url)
    logger.info(f"✅ Bot запущен! Webhook: {webhook_url}")

async def on_shutdown(app):
    await app['application'].stop()
    await app['application'].shutdown()

def main():
    logger.info("🚀 Запуск Waystea Tea Expert Bot...")
    logger.info(f"✅ Gemini ключ настроен")
        
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_user_message))
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

