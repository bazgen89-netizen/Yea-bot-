#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — С отладкой
"""
import os, sys, asyncio, logging, traceback
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
GEMINI_KEY = "AIzaSyAVwIKqdiK05-3AmYLRflYsRue3hm2t1kg"
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "gemini-1.5-flash"

# ==========================================
# 🔥 УСИЛЕННОЕ ЛОГИРОВАНИЕ
# ==========================================
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    stream=sys.stdout,
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('bot_debug.log')
    ]
)
logger = logging.getLogger(__name__)

# ==========================================
# 🧠 КЭШ И КОНСТАНТЫ
# ==========================================
search_cache = {}
GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "доброе утро", "добрый вечер", "приветствую", "хелло", "hello", "hi", "йо", "здарова"]

# ==========================================
# 🔍 ПОИСК
# ==========================================
async def search_chinese_tea_sources(query: str) -> str:
    logger.info(f"🔍 Search: {query[:50]}")
    cache_key = query.lower().strip()
    if cache_key in search_cache:
        logger.info("✅ From cache")
        return search_cache[cache_key]

    if not SERPER_KEY:
        logger.warning("⚠️ No Serper key")
        return "⚠️ Поиск временно недоступен (нет ключа Serper)."

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            queries = [
                f"{query} site:chinadaily.com.cn OR site:tea.cn",
                f"{query} chinese tea brewing"
            ]
            context = ""
            seen = set()
            for q in queries:
                try:
                    async with session.post("https://google.serper.dev/search", headers=headers, json={"q": q, "num": 3, "hl": "ru"}) as resp:
                        logger.debug(f"Search status: {resp.status}")
                        if resp.status == 200:
                            res = await resp.json()
                            for item in res.get("organic", [])[:2]:
                                url = item.get("link", "")
                                if url not in seen:
                                    seen.add(url)
                                    context += f"📌 {item.get('title')}\n🔗 {url}\n📄 {item.get('snippet')}\n\n"
                except Exception as e:
                    logger.warning(f"Search query failed: {e}")
                    continue
    except Exception as e:
        logger.error(f"Search network error: {e}")
        context = ""

    result = context if context else "Информация не найдена. Отвечу на основе знаний."
    search_cache[cache_key] = result
    logger.info(f"✅ Search done: {len(result)} chars")
    return result

# ==========================================
# 🤖 GEMINI API
# ==========================================
async def ask_gemini_expert(system_prompt: str, user_msg: str, context: str) -> str:
    logger.info("🤖 Asking Gemini...")
    if not GEMINI_KEY:
        return "⚠️ Ошибка: ключ Gemini не настроен."

    full_prompt = f"""{system_prompt}

КОНТЕКСТ:
{context}

ВОПРОС: {user_msg}

Отвечай кратко (3-5 абзацев), используй эмодзи 🍃🌡️️, давай точные цифры. Язык: русский."""

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
            logger.debug(f"Gemini URL: {url[:80]}...")
            
            async with session.post(url, json=payload) as resp:
                logger.debug(f"Gemini status: {resp.status}")
                if resp.status == 200:
                    res = await resp.json()
                    logger.debug(f"Gemini response: {res}")
                    candidates = res.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts:
                            answer = parts[0].get("text", "").strip()
                            logger.info(f"✅ Got answer: {len(answer)} chars")
                            return answer
                else:
                    err = await resp.text()
                    logger.error(f"Gemini error {resp.status}: {err}")
                    
        return "⚠️ Временно не могу связаться с базой знаний.\n\n💡 Советы:\n• Вода: 75-80°C для зелёного, 90-95°C для пуэра\n• Пропорция: 5-7 г на 100-150 мл"
    except Exception as e:
        logger.error(f"Gemini failed: {e}\n{traceback.format_exc()}")
        return "⚠️ Ошибка AI. Попробуйте позже."

# ==========================================
# 🧠 ПРОМПТЫ И КЛАССИФИКАЦИЯ
# ==========================================
def get_system_prompt(category: str) -> str:
    base = "Ты эксперт по китайскому чаю. Отвечай точно, доступно, с эмодзи."
    prompts = {
        "brewing": base + " Фокус: температура, время, пропорции, посуда.",
        "storage": base + " Фокус: влажность, температура, хранение.",
        "selection": base + " Фокус: вкус, эффект, бюджет. 2-3 варианта.",
        "history": base + " Фокус: регион, династия, легенды.",
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
# 📩 ОБРАБОТЧИК СООБЩЕНИЙ (С ОТЛАДКОЙ)
# ==========================================
async def process_query(message, user_text: str, category: str):
    try:
        logger.info(f"🔄 Processing: '{user_text[:30]}...' cat={category}")
        logger.info(f"💬 Chat ID: {message.chat.id}")
        
        # Показываем "печатает"
        await message.chat.send_action("typing")
        logger.debug("✍️ Sent typing action")
        
        if category == "general":
            category = classify_question(user_text)
            logger.debug(f"📊 Classified as: {category}")
        
        # Поиск + AI
        context = await search_chinese_tea_sources(user_text)
        prompt = get_system_prompt(category)
        answer = await ask_gemini_expert(prompt, user_text, context)

        footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ на основе китайских источников 🇨🇳"
        full = (answer + footer).strip()
        
        logger.info(f"📤 Sending answer ({len(full)} chars)")
        for i in range(0, len(full), 4000):
            await message.reply_text(full[i:i+4000])
        logger.info("✅ Answer sent")
        
    except Exception as e:
        logger.error(f"❌ CRITICAL ERROR in process_query: {e}\n{traceback.format_exc()}")
        try:
            await message.reply_text(f"⚠️ Произошла ошибка:\n{str(e)}\n\nПопробуйте позже или напишите /start")
        except:
            pass

async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        logger.info(f"📨 Message received from {update.effective_user.id}")
        logger.debug(f"Update: {update}")
        
        if not update.message:
            logger.warning("⚠️ No message in update")
            return
        if not update.message.text:
            logger.warning("⚠️ No text in message")
            return
            
        text = update.message.text.strip()
        logger.info(f"💬 Text: '{text}'")
        
        # Приветствие
        if any(g in text.lower() for g in GREETINGS):
            logger.info("👋 Greeting detected")
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
            logger.info("✅ Greeting sent")
            return
        
        # Обычный запрос
        await process_query(update.message, text, "general")
        
    except Exception as e:
        logger.error(f"❌ CRITICAL in handle_user_message: {e}\n{traceback.format_exc()}")

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        logger.info("🔘 Button callback triggered")
        query = update.callback_query
        if not query:
            logger.error("❌ No callback_query")
            return
        
        logger.info(f"🔘 Button: {query.data}")
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
        else:
            logger.error("❌ No message in callback")
            
    except Exception as e:
        logger.error(f"❌ Button error: {e}\n{traceback.format_exc()}")

# ==========================================
# 📜 КОМАНДЫ
# ==========================================
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"🚀 /start from {update.effective_user.id}")
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

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📖 Примеры:\n• Как заваривать пуэр?\n• Как хранить чай?")

# ==========================================
# 🌐 WEBHOOK
# ==========================================
async def handle_webhook(request):
    try:
        logger.debug("📥 Webhook received")
        update = Update.de_json(await request.json(), request.app['bot'])
        logger.debug(f"Update parsed: {update.update_id if update else 'None'}")
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"❌ Webhook error: {e}\n{traceback.format_exc()}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    app_instance = app['application']
    await app_instance.initialize()
    await app_instance.start()
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await app_instance.bot.set_webhook(webhook_url)
    logger.info(f"✅ Bot started! Webhook: {webhook_url}")
    
    # Тест соединения
    try:
        me = await app_instance.bot.get_me()
        logger.info(f"🤖 Bot username: @{me.username}")
    except Exception as e:
        logger.error(f"❌ Can't get bot info: {e}")

async def on_shutdown(app):
    await app['application'].stop()
    await app['application'].shutdown()

def main():
    logger.info("="*50)
    logger.info("🚀 Starting Waystea Tea Expert Bot...")
    logger.info(f"Token: {TELEGRAM_BOT_TOKEN[:10]}...")
    logger.info(f"Gemini: {'✅' if GEMINI_KEY else '❌'}")
    logger.info(f"Serper: {'✅' if SERPER_KEY else '❌'}")
    logger.info("="*50)
        
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
    
    logger.info("🌐 Starting web server...")
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

