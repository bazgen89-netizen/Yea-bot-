#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Waystea Tea Expert Bot — Рабочая версия с Gemini API
Ключ уже встроен — просто запускайте!
"""
import os, asyncio, logging
from aiohttp import web
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# 🔑 НАСТРОЙКИ (ключи уже вставлены)
# ==========================================
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")

# ✅ Ваш ключ Gemini:
GEMINI_KEY = "AIzaSyDLg9eh-1SACLo3eHB-m0qEcFdLxYx6F0w"
GEMINI_MODEL = "gemini-1.5-flash"

# ==========================================
#  ЛОГИРОВАНИЕ
# ==========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# ==========================================
# 🧠 КОНСТАНТЫ
# ==========================================
GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "доброе утро", "добрый вечер", "хелло", "hello", "hi", "йо"]

# ==========================================
# 🔍 ПОИСК (китайские источники)
# ==========================================
async def search_tea(query: str) -> str:
    if not SERPER_KEY:
        return ""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            # Ищем на китайских и авторитетных чайных сайтах
            q = f"{query} site:chinadaily.com.cn OR site:tea.cn OR chinese tea brewing"
            async with session.post("https://google.serper.dev/search", headers=headers, json={"q": q, "num": 3, "hl": "ru"}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    results = []
                    for item in data.get("organic", [])[:3]:
                        results.append(f"• {item.get('title', '')}: {item.get('snippet', '')}")
                    return "\n".join(results)
    except Exception as e:
        logger.warning(f"Search error: {e}")
    return ""

# ==========================================
# 🤖 GEMINI API (упрощённый и надёжный)
# ==========================================
async def ask_gemini(user_question: str, context: str = "") -> str:
    prompt = f"""Ты — эксперт по китайскому чаю. Знаешь всё о пуэре, улуне, красном, зелёном и белом чае.
Отвечай на русском языке, кратко (3-4 абзаца), с эмодзи 🍃🌡️⏱️.
Давай точные цифры: температура воды, время заваривания, пропорции.

{f'Контекст из источников:\n{context}\n\n' if context else ''}
Вопрос пользователя: {user_question}

Ответ:"""

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as session:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_KEY}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.3,
                    "topK": 32,
                    "topP": 1,
                    "maxOutputTokens": 900
                }
            }
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if "candidates" in data and len(data["candidates"]) > 0:
                        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
                elif resp.status == 400:
                    return "⚠️ Ошибка запроса. Проверьте ключ API в Google AI Studio."
                elif resp.status == 403:
                    return "⚠️ Доступ запрещён. Активируйте ключ на: https://aistudio.google.com/app/apikey"
                else:
                    return f"⚠️ Ошибка API: статус {resp.status}"
    except asyncio.TimeoutError:
        return "⏱️ Превышено время ожидания. Попробуйте ещё раз."
    except Exception as e:
        return f"⚠️ Ошибка соединения: {str(e)[:150]}"

# ==========================================
# 🧠 КЛАССИФИКАЦИЯ ВОПРОСОВ
# ==========================================
def classify(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["заваривать", "температура", "пролив", "гайвань", "вода", "горько"]): return "brewing"
    if any(w in t for w in ["хранить", "хранение", "влажность", "плесень", "старение"]): return "storage"
    if any(w in t for w in ["выбрать", "подобрать", "рекомендуй", "совет", "какой лучше", "купить"]): return "selection"
    if any(w in t for w in ["история", "происхождение", "легенда", "традиция", "откуда", "династия"]): return "history"
    return "general"

# ==========================================
# 📩 ОСНОВНОЙ ОБРАБОТЧИК
# ==========================================
async def process(update: Update, text: str, category: str = "general"):
    async with update.message.chat.action("typing"):
        # Поиск контекста
        context = await search_tea(text)
        # Запрос к Gemini
        answer = await ask_gemini(text, context)
        # Отправка ответа
        footer = "\n\n━━━━━━━━━━━━\n🇨🇳 Источники: китайские чайные сайты + экспертные знания"
        full = f"{answer}{footer}"
        # Разбивка на части если длинное
        for i in range(0, len(full), 4000):
            await update.message.reply_text(full[i:i+4000])

# ==========================================
# 📱 ХЕНДЛЕРЫ TELEGRAM
# ==========================================
async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
    text = update.message.text.strip()
    
    # Приветствие → показываем кнопки
    if any(g in text.lower() for g in GREETINGS):
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🫖 Как заваривать?", callback_data="brewing")],
            [InlineKeyboardButton("🎯 Подобрать чай", callback_data="selection")],
            [InlineKeyboardButton("💾 Хранение чая", callback_data="storage")],
            [InlineKeyboardButton("🏔️ История и легенды", callback_data="history")]
        ])
        await update.message.reply_text(
            "🍵 Здравствуйте! Я — эксперт по китайскому чаю.\n"
            "Выберите тему или просто напишите свой вопрос:",
            reply_markup=keyboard
        )
        return
    
    # Обычный вопрос
    cat = classify(text)
    await process(update, text, cat)

async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработка нажатий на кнопки"""
    query = update.callback_query
    if not query:
        return
    await query.answer()  # Обязательно!
    
    # Тексты для кнопок
    prompts = {
        "brewing": "Как правильно заваривать китайский чай?",
        "selection": "Помоги выбрать чай под мой вкус и бюджет",
        "storage": "Как правильно хранить чай дома?",
        "history": "Расскажи историю и происхождение китайского чая"
    }
    
    question = prompts.get(query.data, "Расскажи о китайском чае")
    
    # Создаём фейковый update для process()
    class FakeMsg:
        def __init__(self, chat):
            self.chat = chat
        async def reply_text(self, text, **kwargs):
            await query.message.reply_text(text, **kwargs)
    
    class FakeUpdate:
        def __init__(self, chat):
            self.message = FakeMsg(chat)
            async def typing(): pass
            self.message.chat.action = lambda _: typing()
    
    fake = FakeUpdate(query.message.chat)
    await process(fake, question, query.data)

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /start"""
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🫖 Заваривание", callback_data="brewing")],
        [InlineKeyboardButton("🎯 Подбор чая", callback_data="selection")],
        [InlineKeyboardButton("💾 Хранение", callback_data="storage")],
        [InlineKeyboardButton("🏔️ История", callback_data="history")]
    ])
    await update.message.reply_text(
        "🍵 <b>Waystea Tea Expert</b>\n\n"
        "Я — ваш персональный эксперт по <b>китайскому чаю</b>.\n\n"
        "• 📚 Расскажу о любом чае (пуэр, улун, красный, зелёный)\n"
        "• 🫖 Научу заваривать по китайской традиции\n"
        "• 💾 Подскажу, как правильно хранить чай\n"
        "• 🎯 Помогу выбрать чай под ваш вкус\n"
        "• 🏔️ Поделюсь историей и легендами\n\n"
        "Выберите тему или напишите вопрос! 🍃",
        reply_markup=keyboard, parse_mode='HTML'
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
    application = app['application']
    await application.initialize()
    await application.start()
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await application.bot.set_webhook(webhook_url)
    logger.info(f"✅ Bot запущен! @{application.bot.username}")

async def on_shutdown(app):
    await app['application'].stop()
    await app['application'].shutdown()

def main():
    logger.info("🚀 Запуск Waystea Tea Expert Bot...")
    logger.info(f"Telegram Token: {'✅' if TELEGRAM_BOT_TOKEN else '❌'}")
    logger.info(f"Gemini Key: {'✅' if GEMINI_KEY else '❌'}")
    logger.info(f"Serper Key: {'✅' if SERPER_KEY else '❌'}")
    
    # Создаём приложение
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Регистрируем хендлеры
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    application.add_handler(CallbackQueryHandler(on_button, pattern=r'^(brewing|selection|storage|history)$'))
    
    # Web-сервер для webhook
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['application'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    # Запускаем
    port = int(os.getenv('PORT', 8080))
    logger.info(f"🌐 Слушаю порт {port}...")
    web.run_app(web_app, host='0.0.0.0', port=port)

if __name__ == "__main__":
    main()

