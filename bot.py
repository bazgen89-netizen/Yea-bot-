#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — Исправленная версия с логированием
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

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
YOUR_TELEGRAM_ID = int(os.getenv("YOUR_TELEGRAM_ID", "0") or "0")
GEMINI_KEY = os.getenv("GEMINI_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "gemini-1.5-flash"

# Увеличиваем уровень логирования
logging.basicConfig(
    level=logging.DEBUG, 
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s', 
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

search_cache = {}
GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "доброе утро", "добрый вечер", "приветствую", "хелло", "hello", "hi", "йо", "здарова", "прив"]

# ---------------------------------------------------------
# 🔍 ПОИСК
# ---------------------------------------------------------
async def search_chinese_tea_sources(query: str) -> str:
    logger.info(f"🔍 Поиск по запросу: {query[:50]}")
    cache_key = query.lower().strip()
    if cache_key in search_cache:
        logger.info("✅ Возвращаем из кэша")
        return search_cache[cache_key]

    if not SERPER_KEY:
        logger.warning("⚠️ Нет ключа Serper")
        return "⚠️ Поиск временно недоступен."

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            search_queries = [
                f"{query} site:chinadaily.com.cn OR site:tea.cn",
                f"{query} chinese tea brewing"
            ]
            all_context = ""
            seen_urls = set()
            for q in search_queries:
                data = {"q": q, "num": 3, "hl": "ru"}
                try:
                    async with session.post("https://google.serper.dev/search", headers=headers, json=data) as resp:
                        logger.debug(f"Search status: {resp.status}")
                        if resp.status == 200:
                            result = await resp.json()
                            for item in result.get("organic", [])[:2]:
                                url = item.get('link', '')
                                if url not in seen_urls:
                                    seen_urls.add(url)
                                    all_context += f"📌 {item.get('title')}\n🔗 {url}\n📄 {item.get('snippet')}\n\n"
                except Exception as e:
                    logger.warning(f"Search query failed: {e}")
                    continue
    except Exception as e:
        logger.error(f"Search error: {e}")
        all_context = ""

    result = all_context if all_context else "Информация не найдена. Отвечу на основе знаний."
    search_cache[cache_key] = result
    logger.info(f"✅ Найдено контекста: {len(result)} символов")
    return result

# ---------------------------------------------------------
# 🤖 GEMINI API
# ---------------------------------------------------------
async def ask_gemini_expert(system_prompt: str, user_message: str, context: str) -> str:
    logger.info("🤖 Запрос к Gemini...")
    if not GEMINI_KEY:
        return "⚠️ Ошибка: не настроен ключ Gemini."

    full_prompt = f"""{system_prompt}

КОНТЕКСТ:
{context}

ВОПРОС: {user_message}

Отвечай кратко (3-5 абзацев), используй эмодзи 🍃🌡️⏱️, давай точные цифры. Язык: русский."""

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
            logger.debug(f"Gemini URL: {url[:80]}...")
            
            async with session.post(url, json=payload) as resp:
                logger.debug(f"Gemini response status: {resp.status}")
                if resp.status == 200:
                    res = await resp.json()
                    logger.debug(f"Gemini response: {res}")
                    candidates = res.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts:
                            answer = parts[0].get("text", "").strip()
                            logger.info(f"✅ Получен ответ: {len(answer)} символов")
                            return answer
                else:
                    error_text = await resp.text()
                    logger.error(f"Gemini error {resp.status}: {error_text}")
                    
        return "⚠️ Временно не могу связаться с базой знаний.\n\n💡 Базовые советы:\n• Вода: 75-80°C для зелёного, 90-95°C для пуэра\n• Пропорция: 5-7 г на 100-150 мл"
    except Exception as e:
        logger.error(f"Gemini failed: {e}\n{traceback.format_exc()}")
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
# 📩 ОБРАБОТКА СООБЩЕНИЙ
# ---------------------------------------------------------
async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        logger.info(f" Получено сообщение от {update.effective_user.id}: {update.message.text[:50]}")
        
        if not update.message or not update.message.text:
            logger.warning("⚠️ Пустое сообщение")
            return
            
        user_text = update.message.text.strip()
        
        # Проверка на приветствие
        text_lower = user_text.lower()
        if any(greet in text_lower for greet in GREETINGS):
            logger.info("👋 Распознано приветствие")
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
            return
        
        logger.info("💬 Обрабатываем обычный запрос...")
        await process_query(update.message, user_text, "general")
        
    except Exception as e:
        logger.error(f"❌ Error in handle_user_message: {e}\n{traceback.format_exc()}")
        try:
            await update.message.reply_text("⚠️ Произошла ошибка. Попробуйте позже.")
        except:
            pass

async def process_query(message, user_text: str, category: str):
    """Универсальная обработка запроса"""
    try:
        logger.info(f"🔄 Process query: {user_text[:30]}... category={category}")
        
        # Отправляем статус "печатает"
        await message.chat.send_action("typing")
        logger.debug("📤 Отправлен статус 'печатает'")
        
        if category == "general":
            category = await classify_question(user_text)
            logger.debug(f"Классифицировано как: {category}")
        
        search_context = await search_chinese_tea_sources(user_text)
        system_prompt = get_system_prompt(category)
        answer = await ask_gemini_expert(system_prompt, user_text, search_context)

        footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ на основе китайских источников 🇨🍃"
        full_answer = (answer + footer).strip()

        logger.info(f"📤 Отправляем ответ ({len(full_answer)} символов)")
        # Отправляем частями если нужно
        for i in range(0, len(full_answer), 4000):
            await message.reply_text(full_answer[i:i+4000])
        logger.info("✅ Ответ отправлен")
        
    except Exception as e:
        logger.error(f"❌ Error in process_query: {e}\n{traceback.format_exc()}")
        try:
            await message.reply_text("⚠️ Произошла ошибка при обработке. Попробуйте позже.")
        except:
            pass

# ---------------------------------------------------------
# 🔘 ОБРАБОТКА КНОПОК
# ---------------------------------------------------------
async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка нажатий на inline-кнопки"""
    try:
        logger.info("🔘 Button callback triggered")
        query = update.callback_query
        if query is None:
            logger.error("❌ callback_query is None")
            return
        
        logger.info(f"🔘 Button pressed: {query.data}")
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
        else:
            logger.error("❌ query.message is None")
            
    except Exception as e:
        logger.error(f"❌ Error in button_callback: {e}\n{traceback.format_exc()}")

# ---------------------------------------------------------
# 📜 КОМАНДЫ
# ---------------------------------------------------------
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"🚀 Start command from {update.effective_user.id}")
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
        "• Как хранить пуэр?", parse_mode='HTML'
    )

# ---------------------------------------------------------
# 🌐 WEBHOOK
# ---------------------------------------------------------
async def handle_webhook(request):
    try:
        update = Update.de_json(await request.json(), request.app['bot'])
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}\n{traceback.format_exc()}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    application = app['application']
    await application.initialize()
    await application.start()
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await application.bot.set_webhook(webhook_url)
    logger.info(f"✅ Bot запущен! Webhook: {webhook_url}")

async def on_shutdown(app):
    application = app['application']
    await application.stop()
    await application.shutdown()

def main():
    logger.info("🚀 Запуск бота...")
    logger.info(f"Token: {TELEGRAM_BOT_TOKEN[:10]}...")
    logger.info(f"Gemini Key: {'✅' if GEMINI_KEY else '❌'}")
    logger.info(f"Serper Key: {'✅' if SERPER_KEY else '❌'}")
    
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

