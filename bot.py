#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — С проверкой Gemini
"""
import os, sys, asyncio, logging
from aiohttp import web, ClientSession
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
GEMINI_KEY = "AIzaSyAVwIKqdiK05-3AmYLRflYsRue3hm2t1kg"
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "gemini-1.5-flash"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

search_cache = {}
GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "доброе утро", "добрый вечер", "приветствую", "хелло", "hello", "hi"]

# ==========================================
# 🔧 ПРОВЕРКА GEMINI API
# ==========================================
async def test_gemini_connection():
    """Проверяет доступность Gemini API"""
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={GEMINI_KEY}"
            payload = {
                "contents": [{"parts": [{"text": "Hi"}]}],
                "generationConfig": {"maxOutputTokens": 10}
            }
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    logger.info("✅ Gemini API работает!")
                    return True
                else:
                    error = await resp.text()
                    logger.error(f"❌ Gemini API error {resp.status}: {error}")
                    return False
    except Exception as e:
        logger.error(f"❌ Gemini connection test failed: {e}")
        return False

# ==========================================
# 🔍 ПОИСК
# ==========================================
async def search_chinese_tea_sources(query: str) -> str:
    if not SERPER_KEY:
        return "⚠️ Нет ключа Serper."

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            queries = [
                f"{query} site:chinadaily.com.cn OR site:tea.cn",
                f"{query} chinese tea brewing guide"
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
                except:
                    continue
    except Exception as e:
        logger.error(f"Search error: {e}")
        context = ""

    return context if context else "Информация не найдена."

# ==========================================
# 🤖 GEMINI API (ИСПРАВЛЕННЫЙ)
# ==========================================
async def ask_gemini_expert(system_prompt: str, user_msg: str, context: str) -> str:
    if not GEMINI_KEY:
        return "⚠️ Ключ Gemini не настроен."

    # Упрощенный промпт
    full_prompt = f"""{system_prompt}

КОНТЕКСТ: {context}

ВОПРОС: {user_msg}

Отвечай кратко на русском, используй эмодзи 🍃."""

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as session:
            # Правильный формат запроса для Gemini
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": full_prompt}]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.3,
                    "topK": 32,
                    "topP": 1,
                    "maxOutputTokens": 800,
                },
                "safetySettings": []
            }
            
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={GEMINI_KEY}"
            logger.info(f"📤 Gemini request to: {url[:80]}...")
            
            async with session.post(url, json=payload) as resp:
                logger.info(f"📥 Gemini response status: {resp.status}")
                
                if resp.status == 200:
                    res = await resp.json()
                    logger.debug(f"Gemini response: {res}")
                    
                    # Извлекаем ответ
                    try:
                        if "candidates" in res and len(res["candidates"]) > 0:
                            candidate = res["candidates"][0]
                            if "content" in candidate and "parts" in candidate["content"]:
                                answer = candidate["content"]["parts"][0]["text"]
                                logger.info(f"✅ Got answer: {len(answer)} chars")
                                return answer.strip()
                    except Exception as e:
                        logger.error(f"Parse error: {e}")
                    
                    return "⚠️ Не удалось распарсить ответ Gemini."
                elif resp.status == 400:
                    error = await resp.text()
                    logger.error(f"Bad request: {error}")
                    return f"⚠️ Ошибка запроса к Gemini (400). Проверьте ключ API."
                elif resp.status == 403:
                    error = await resp.text()
                    logger.error(f"Forbidden: {error}")
                    return f"⚠️ Доступ запрещен (403). Возможно, нужно активировать API в Google Cloud Console."
                else:
                    error = await resp.text()
                    logger.error(f"Error {resp.status}: {error}")
                    return f"⚠️ Ошибка Gemini API: статус {resp.status}"
                    
    except asyncio.TimeoutError:
        logger.error("⏱️ Gemini request timeout")
        return "⏱️ Превышено время ожидания ответа от AI."
    except Exception as e:
        logger.error(f"Gemini request failed: {e}")
        return f"⚠️ Ошибка соединения: {str(e)[:100]}"

# ==========================================
# 🧠 ПРОМПТЫ
# ==========================================
def get_system_prompt(category: str) -> str:
    base = "Ты эксперт по китайскому чаю. Отвечай точно и доступно."
    prompts = {
        "brewing": base + " Фокус: температура, время, пропорции, посуда.",
        "storage": base + " Фокус: влажность, температура, хранение.",
        "selection": base + " Фокус: вкус, эффект, бюджет.",
        "history": base + " Фокус: регион, история, легенды.",
        "general": base
    }
    return prompts.get(category, prompts["general"])

def classify_question(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["заваривать", "температура", "пролив", "гайвань", "вода"]): return "brewing"
    if any(w in t for w in ["хранить", "хранение", "влажность"]): return "storage"
    if any(w in t for w in ["выбрать", "подобрать", "рекомендуй", "совет"]): return "selection"
    if any(w in t for w in ["история", "происхождение", "легенда"]): return "history"
    return "general"

# ==========================================
# 📩 ОБРАБОТЧИКИ
# ==========================================
async def process_query(message, user_text: str, category: str):
    try:
        async with message.chat.action("typing"):
            if category == "general":
                category = classify_question(user_text)
            
            context = await search_chinese_tea_sources(user_text)
            prompt = get_system_prompt(category)
            answer = await ask_gemini_expert(prompt, user_text, context)

        footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ на основе китайских источников 🇨"
        full = (answer + footer).strip()
        
        for i in range(0, len(full), 4000):
            await message.reply_text(full[i:i+4000])
            
    except Exception as e:
        logger.error(f"❌ ERROR: {e}")
        await message.reply_text(f"⚠️ Ошибка: {str(e)}")

async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
        
    text = update.message.text.strip()
    
    if any(g in text.lower() for g in GREETINGS):
        keyboard = [
            [InlineKeyboardButton("🫖 Как заваривать?", callback_data="brewing")],
            [InlineKeyboardButton("🎯 Подобрать чай", callback_data="selection")],
            [InlineKeyboardButton("💾 Хранение чая", callback_data="storage")],
            [InlineKeyboardButton("🏔️ История", callback_data="history")]
        ]
        await update.message.reply_text(
            "🍵 Здравствуйте! Я — эксперт по китайскому чаю.\n\nВыберите тему или напишите вопрос:",
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
        "selection": "Помоги выбрать чай",
        "storage": "Как хранить чай?",
        "history": "История китайского чая"
    }
    
    user_text = prompts.get(category, "О чае")
    if query.message:
        await process_query(query.message, user_text, category)

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🫖 Заваривание", callback_data="brewing")],
        [InlineKeyboardButton("🎯 Подбор", callback_data="selection")],
        [InlineKeyboardButton("💾 Хранение", callback_data="storage")],
        [InlineKeyboardButton("🏔️ История", callback_data="history")]
    ]
    await update.message.reply_text(
        "🍵 <b>Waystea Tea Expert</b>\n\nВыберите тему:",
        reply_markup=InlineKeyboardMarkup(keyboard), parse_mode='HTML'
    )

async def test_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда для проверки Gemini API"""
    await update.message.reply_text("🔧 Проверяю соединение с Gemini API...")
    result = await test_gemini_connection()
    if result:
        await update.message.reply_text("✅ Gemini API работает! Бот готов к работе.")
    else:
        await update.message.reply_text(
            "❌ Gemini API не отвечает.\n\n"
            "🔧 Что проверить:\n"
            "1. Откройте https://aistudio.google.com/app/apikey\n"
            "2. Убедитесь, что ключ активен\n"
            "3. Возможно, нужно привязать карту (бесплатно)\n"
            "4. Проверьте лимиты запросов"
        )

# ==========================================
# 🌐 ЗАПУСК
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
    logger.info(f"✅ Bot started!")
    
    # Тест Gemini при запуске
    logger.info("🔧 Testing Gemini API...")
    gemini_ok = await test_gemini_connection()
    if gemini_ok:
        logger.info("✅ Gemini API is ready!")
    else:
        logger.error("❌ Gemini API is NOT working!")

async def on_shutdown(app):
    await app['application'].stop()
    await app['application'].shutdown()

def main():
    logger.info("="*50)
    logger.info("🚀 Starting Waystea Tea Expert Bot...")
    logger.info(f"Gemini: {'✅' if GEMINI_KEY else '❌'}")
    logger.info(f"Serper: {'✅' if SERPER_KEY else '❌'}")
    logger.info("="*50)
        
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("test", test_cmd))  # Новая команда
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

