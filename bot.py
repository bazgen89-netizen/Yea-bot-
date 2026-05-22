#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — Эксперт по китайскому чаю (Gemini + Serper)
Требует: python-telegram-bot>=20.0, aiohttp, python-dotenv
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

# 🔑 НАСТРОЙКИ
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
# 🔍 ПОИСК (Китайские источники + кэш)
# ---------------------------------------------------------
async def search_chinese_tea_sources(query: str) -> str:
    cache_key = query.lower().strip()
    if cache_key in search_cache:
        return search_cache[cache_key]

    if not SERPER_KEY:
        return "⚠️ Поиск временно недоступен (нет ключа Serper)."

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            search_queries = [
                f"{query} site:chinadaily.com.cn OR site:xinhuanet.com OR site:tea.cn OR site:teavivre.com",
                f"{query} chinese tea origin processing tradition",
                f"{query} чай Китай происхождение обработка заваривание"
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
                    logger.warning(f"Search failed for '{q}': {e}")
                    continue
    except Exception as e:
        logger.error(f"Search network error: {e}")
        all_context = ""

    result = all_context if all_context else "Информация из источников не найдена. Отвечу на основе экспертных знаний."
    search_cache[cache_key] = result
    return result

# ---------------------------------------------------------
# 🤖 GEMINI API (оптимизировано под скорость и качество)
# ---------------------------------------------------------
async def ask_gemini_expert(system_prompt: str, user_message: str, context: str) -> str:
    if not GEMINI_KEY:
        return "⚠️ Ошибка: не настроен ключ Gemini."

    full_prompt = f"""{system_prompt}

КОНТЕКСТ ИЗ ИСТОЧНИКОВ:
{context}

ВОПРОС ПОЛЬЗОВАТЕЛЯ:
{user_message}

Формат ответа:
• Кратко и по делу (3-5 абзацев)
• Используй эмодзи 🍃🌡️⏱️📍 для структуры
• Давай точные цифры (температура, время, граммы)
• Если информации в контексте нет — честно скажи, но дай полезный ответ из своих знаний
• Язык: простой русский, без сложной терминологии"""

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as session:
            payload = {
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {
                    "temperature": 0.25,
                    "topK": 30,
                    "topP": 0.9,
                    "maxOutputTokens": 900,
                    "stopSequences": ["\n\n\n"]
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
                    return "⚠️ Gemini вернул пустой ответ."
                else:
                    error = await resp.text()
                    logger.error(f"Gemini API error {resp.status}: {error}")
                    raise Exception(f"API {resp.status}")
    except Exception as e:
        logger.error(f"Gemini request failed: {e}")
        return (
            "⚠️ Временно не могу связаться с экспертной базой.\n\n"
            "💡 Базовые советы:\n"
            "• Вода: 75-80°C для зелёного/белого, 90-95°C для улуна/пуэра\n"
            "• Пропорция: 5-7 г чая на 100-150 мл воды (гайвань)\n"
            "• Первый пролив часто сливают для «промывки» листа\n"
            "• Храните чай вдали от света, влаги и сильных запахов\n\n"
            "Попробуйте позже или уточните вопрос 🍃"
        )

# ---------------------------------------------------------
# 🧠 ПРОМПТЫ И КЛАССИФИКАЦИЯ
# ---------------------------------------------------------
def get_system_prompt(category: str) -> str:
    base = ("Ты — эксперт по китайскому чаю. Знаешь традиции, регионы, обработку и заваривание. "
            "Отвечай точно, доступно, с опорой на факты. Всегда указывай регион, если он известен. "
            "Если используешь источники — кратко ссылайся на них.")
    prompts = {
        "brewing": base + " Фокус: температура воды, время проливов, пропорции, тип посуды (гайвань/чайник/стекло), когда нужен первый пролив.",
        "storage": base + " Фокус: влажность, температура, вентиляция, разница хранения шен/шу пуэра, чего избегать, признаки старения.",
        "selection": base + " Фокус: вкус, эффект, бюджет. Предлагай 2-3 варианта с описанием профиля, регионом и мини-инструкцией по завариванию.",
        "history": base + " Фокус: точный регион, династия/период, легенды (с пометкой), эволюция технологии, современные особенности.",
        "general": base + " Отвечай как универсальный эксперт. Если вопрос размыт — задай уточняющий. Будь дружелюбен."
    }
    return prompts.get(category, prompts["general"])

async def classify_question(user_text: str) -> str:
    t = user_text.lower()
    if any(w in t for w in ["как заваривать", "заварка", "температура", "пролив", "гайвань", "чайник", "сколько минут", "вода", "горько", "горчит"]):
        return "brewing"
    if any(w in t for w in ["хранить", "хранение", "срок", "влажность", "испортился", "плесень", "запах", "старение"]):
        return "storage"
    if any(w in t for w in ["выбрать", "подобрать", "рекомендуй", "совет", "какой лучше", "купить", "посоветуй", "для начина", "подари"]):
        return "selection"
    if any(w in t for w in ["история", "происхождение", "откуда", "легенда", "традиция", "кто придумал", "династия", "родина"]):
        return "history"
    return "general"

# ---------------------------------------------------------
# 📩 ОБРАБОТКА СООБЩЕНИЙ
# ---------------------------------------------------------
async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text.strip()
    if await handle_greeting(update, user_text):
        return

    async with update.message.chat.action("typing"):
        # Параллельный запуск для экономии времени
        category, search_context = await asyncio.gather(
            classify_question(user_text),
            search_chinese_tea_sources(user_text)
        )
        system_prompt = get_system_prompt(category)
        answer = await ask_gemini_expert(system_prompt, user_text, search_context)

    footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ сформирован на основе китайских источников и экспертных знаний 🇨🇳🍃"
    full_answer = (answer + footer).strip()

    # Отправка частями, если длинное
    for i in range(0, len(full_answer), 4000):
        await update.message.reply_text(full_answer[i:i+4000])

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    prompts = {
        "brewing": "Как правильно заваривать китайский чай?",
        "selection": "Помоги выбрать чай под мой вкус",
        "storage": "Как правильно хранить чай дома?",
        "history": "Расскажи историю китайского чая и его происхождение"
    }
    user_text = prompts.get(query.data, "Расскажи о чае")

    async with query.message.chat.action("typing"):
        category = query.data
        search_context = await search_chinese_tea_sources(user_text)
        system_prompt = get_system_prompt(category)
        answer = await ask_gemini_expert(system_prompt, user_text, search_context)

    footer = "\n\n━━━━━━━━━━━━\nℹ️ Ответ сформирован на основе китайских источников и экспертных знаний 🇨🇳🍃"
    full_answer = (answer + footer).strip()
    for i in range(0, len(full_answer), 4000):
        await query.message.reply_text(full_answer[i:i+4000])

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
        "Я — ваш персональный эксперт по <b>китайскому чаю</b>.\n\n"
        "<b>Что я умею:</b>\n"
        "• 📚 Рассказать о любом чае (пуэр, улун, красный, зелёный, белый)\n"
        "• 🫖 Научить заваривать по китайской традиции\n"
        "• 💾 Подсказать, как правильно хранить чай\n"
        "• 🎯 Помочь выбрать чай под ваш вкус\n"
        "• 🏔️ Поделиться историей и происхождением\n\n"
        "Выберите тему или напишите вопрос!",
        reply_markup=InlineKeyboardMarkup(keyboard), parse_mode='HTML'
    )

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 <b>Примеры вопросов:</b>\n\n"
        "🔸 <i>Как заваривать шен пуэр в гайвани?</i>\n"
        "🔸 <i>Чем отличается шу от шен пуэра?</i>\n"
        "🔸 <i>Как хранить пуэр дома в квартире?</i>\n"
        "🔸 <i>Какой улун самый ароматный и цветочный?</i>\n"
        "🔸 <i>Что такое Да Хун Пао и где его выращивают?</i>\n"
        "🔸 <i>Рекомендуй чай для утра / для вечера</i>\n"
        "🔸 <i>Почему чай горчит? Как исправить?</i>\n\n"
        "Спрашивайте что угодно о китайском чае! 🇨🇳🍵", parse_mode='HTML'
    )

# ---------------------------------------------------------
# 🌐 WEBHOOK & APP LIFECYCLE
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
    logger.info("✅ Waystea Expert Bot запущен! (Gemini + китайские источники)")

async def on_shutdown(app):
    application = app['application']
    await application.stop()
    await application.shutdown()

def main():
    logger.info("🚀 Запуск Waystea Tea Expert Bot (Gemini Edition)...")
    
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_user_message))
    application.add_handler(CallbackQueryHandler(button_callback))
    
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['application'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

