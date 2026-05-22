#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Waystea Tea Expert Bot — GitHub + Render Ready (с командой /test)
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
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "ВАШ_ТОКЕН_БОТА_ТУТ")
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
GEMINI_KEY = "AIzaSyDLg9eh-1SACLo3eHB-m0qEcFdLxYx6F0w"
GEMINI_MODEL = "gemini-1.5-flash"
SERPER_KEY = os.getenv("SERPER_KEY", "")

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

GREETINGS = ["привет", "здравствуй", "хай", "добрый день", "hello", "hi", "ку"]

# ==========================================
# 🔧 ПРОВЕРКА GEMINI (Команда /test)
# ==========================================
async def test_gemini(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Проверяет, работает ли API Gemini"""
    msg = await update.message.reply_text("🔧 Проверяю соединение с Gemini API...")
    
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_KEY}"
            payload = {"contents": [{"parts": [{"text": "Hi"}]}], "generationConfig": {"maxOutputTokens": 5}}
            
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    await msg.edit_text("✅ **Gemini API работает!**\n\nБот готов к ответам на вопросы о чае. 🍵")
                elif resp.status == 400:
                    await msg.edit_text("❌ **Ошибка 400: Неверный запрос**\n\nВозможно, ключ неактивен или формат запроса неверен.")
                elif resp.status == 403:
                    await msg.edit_text("❌ **Ошибка 403: Доступ запрещен**\n\n⚠️ Нужно активировать ключ:\n1. Откройте https://aistudio.google.com/app/apikey\n2. Нажмите 'Enable API'\n3. Привяжите карту (бесплатно)")
                else:
                    await msg.edit_text(f"⚠️ **Статус ответа: {resp.status}**\n\nПопробуйте позже.")
    except Exception as e:
        await msg.edit_text(f"⚠️ **Ошибка соединения:**\n{str(e)[:200]}")

# ==========================================
# 🔍 ПОИСК
# ==========================================
async def search_tea(query: str) -> str:
    if not SERPER_KEY: return ""
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            q = f"{query} site:chinadaily.com.cn OR site:tea.cn"
            async with session.post("https://google.serper.dev/search", headers=headers, json={"q": q, "num": 3, "hl": "ru"}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return "\n".join([f"• {i.get('title')}: {i.get('snippet')}" for i in data.get("organic", [])[:3]])
    except: pass
    return ""

# ==========================================
# 🤖 GEMINI API
# ==========================================
async def ask_gemini(user_question: str, context: str = "") -> str:
    prompt = f"""Ты эксперт по китайскому чаю. Отвечай кратко на русском с эмодзи 🍃.
{f'Контекст:\n{context}\n\n' if context else ''}Вопрос: {user_question}\nОтвет:"""

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as session:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_KEY}"
            payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.3, "maxOutputTokens": 900}}
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if "candidates" in data and len(data["candidates"]) > 0:
                        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
                return f"⚠️ Ошибка Gemini: {resp.status}"
    except Exception as e:
        return f"⚠️ Ошибка AI: {str(e)[:100]}"

# ==========================================
# 📱 ЛОГИКА БОТА
# ==========================================
def classify(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["заваривать", "температура", "вода"]): return "brewing"
    if any(w in t for w in ["хранить", "влажность"]): return "storage"
    if any(w in t for w in ["выбрать", "какой"]): return "selection"
    return "general"

async def process(update: Update, text: str, category: str = "general"):
    async with update.message.chat.action("typing"):
        context = await search_tea(text)
        answer = await ask_gemini(text, context)
        footer = "\n\n━━━━━━━━━━━━\n🇨 Источники: Китайские чайные сайты"
        full = f"{answer}{footer}"
        for i in range(0, len(full), 4000):
            await update.message.reply_text(full[i:i+4000])

async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    text = update.message.text.strip()
    
    if any(g in text.lower() for g in GREETINGS):
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🫖 Заваривание", callback_data="brewing")],
            [InlineKeyboardButton("🎯 Подбор", callback_data="selection")],
            [InlineKeyboardButton("💾 Хранение", callback_data="storage")],
            [InlineKeyboardButton("🏔️ История", callback_data="history")]
        ])
        await update.message.reply_text("🍵 Привет! Я эксперт по чаю.\nВыбери тему:", reply_markup=kb)
        return
    await process(update, text, classify(text))

async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not query: return
    await query.answer()
    prompts = {"brewing": "Как заваривать чай?", "selection": "Помоги выбрать чай", "storage": "Как хранить чай?", "history": "История чая"}
    
    class FakeMsg:
        def __init__(self, chat): self.chat = chat
        async def reply_text(self, txt, **kw): await query.message.reply_text(txt, **kw)
    class FakeUpdate:
        def __init__(self, chat): self.message = FakeMsg(chat)
    await process(FakeUpdate(query.message.chat), prompts.get(query.data, "О чае"), query.data)

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🫖 Заваривание", callback_data="brewing")],
        [InlineKeyboardButton("🎯 Подбор", callback_data="selection")],
        [InlineKeyboardButton("💾 Хранение", callback_data="storage")],
        [InlineKeyboardButton("🏔️ История", callback_data="history")]
    ])
    await update.message.reply_text("🍵 <b>Tea Expert Bot</b>\n\nЯ знаю всё о китайском чае!\nВыберите тему или напишите вопрос:", reply_markup=kb, parse_mode='HTML')

# ==========================================
# 🚀 ЗАПУСК
# ==========================================
async def handle_webhook(request):
    try:
        update = Update.de_json(await request.json(), request.app['bot'])
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        return web.Response(text="Error", status=500)

async def on_startup(app):
    await app['application'].initialize()
    await app['application'].start()
    await app['application'].bot.set_webhook(os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"))
    logger.info(f"✅ Bot started! @{app['application'].bot.username}")

async def on_shutdown(app):
    await app['application'].stop()
    await app['application'].shutdown()

def main():
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Добавляем обработчики команд
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("test", test_gemini))  # ✅ Команда /test добавлена!
    
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    application.add_handler(CallbackQueryHandler(on_button))
    
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['application'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

