#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — Оптимизированная версия (Быстрый ответ)
"""
import os, asyncio, logging, time
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

# 🚀 Быстрая модель (Gemma 2B отвечает быстрее Mistral 7B)
HF_MODEL = "google/gemma-2-2b-it"

# 🧠 Кэш для поиска (ускоряет повторные запросы)
search_cache = {}
CACHE_TTL = 300  # 5 минут

REGIONS = {
    "yunnan": "Юньнань (Пуэр)",
    "fujian": "Фуцзянь (Улуны)",
    "zhejiang": "Чжэцзян (Лунцзин)",
    "anhui": "Аньхой (Красный чай)",
    "sichuan": "Сычуань (Зелёный)",
    "hunan": "Хунань (Чёрный чай)"
}

async def ask_hf_fast(prompt: str) -> str:
    """Быстрый запрос к HF с оптимизированными параметрами"""
    if not HF_TOKEN or HF_TOKEN.startswith("hf_x"):
        return "⚠️ AI отключён"
    
    headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}
    # Короткий промпт = быстрый ответ
    payload = {
        "inputs": f"<bos><start_of_turn>user\nТы эксперт по чаю. Отвечай кратко (2-3 предложения) на русском с эмодзи 🍃.\n\n{prompt}<end_of_turn>\n<start_of_turn>model\n",
        "parameters": {
            "max_new_tokens": 300,  # Меньше токенов = быстрее
            "temperature": 0.2,     # Ниже = стабильнее
            "top_p": 0.9,
            "return_full_text": False,
            "do_sample": True
        }
    }
    
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            url = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
            async with session.post(url, headers=headers, json=payload) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    if result and len(result) > 0:
                        return result[0].get('generated_text', '').strip()
                elif resp.status == 503:
                    return " Модель просыпается... Повторите через 30 сек."
                else:
                    return f"⚠️ Ошибка: {resp.status}"
    except Exception as e:
        return f"⚠️ Ошибка: {str(e)[:80]}"

async def search_fast(q: str) -> str:
    """Поиск с кэшированием"""
    if not SERPER_KEY: return ""
    
    cache_key = q.lower().strip()
    if cache_key in search_cache:
        cached_time, cached_data = search_cache[cache_key]
        if time.time() - cached_time < CACHE_TTL:
            return cached_data
    
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.post("https://google.serper.dev/search", 
                            headers={"X-API-KEY": SERPER_KEY}, 
                            json={"q": q, "num": 2, "hl": "ru"}) as r:  # num=2 быстрее
                if r.status == 200:
                    data = await r.json()
                    result = "\n".join([f"• {i.get('title')}" for i in data.get("organic", [])[:2]])
                    search_cache[cache_key] = (time.time(), result)
                    return result
    except: pass
    return ""

async def fast_reply(update: Update, text: str, callback=None):
    """Быстрый ответ с индикатором"""
    msg = await update.message.reply_text("⏳ Ищу информацию...")
    
    start_time = time.time()
    
    # Параллельный поиск и генерация
    search_task = asyncio.create_task(search_fast(text))
    
    # Ждём поиск, потом генерируем ответ
    search_result = await search_task
    
    # Если прошло больше 10 секунд, обновляем сообщение
    if time.time() - start_time > 10:
        await msg.edit_text("⏳ Генерирую ответ...")
    
    answer = await ask_hf_fast(f"Вопрос: {text}\nКонтекст: {search_result}")
    
    elapsed = time.time() - start_time
    footer = f"\n\n⚡ Ответ за {elapsed:.1f}сек | Источники: поиск"
    
    await msg.edit_text(f"{answer}{footer}")

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
        await fast_reply(update, f"Минимальная цена на {text} в России. Ищи на Ozon, WB, Avito.")
        return

    await fast_reply(update, text)

async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    d, m = q.data, q.message
    
    if d == "brew":
        msg = await m.reply_text("⏳ Ищу гайды...")
        search_data = await search_fast("как заваривать китайский чай гайвань температура время пропорции")
        answer = await ask_hf_fast(f"Инструкция по завариванию чая в гайвани: температура воды, время пролива, граммы чая на 100мл. Данные: {search_data}")
        await msg.edit_text(f"{answer}\n\n Китайские гайды")
        
    elif d == "news":
        kb = InlineKeyboardMarkup([[InlineKeyboardButton(name, callback_data=f"reg_{code}")] for code, name in REGIONS.items()])
        await m.reply_text(" Выберите регион:", reply_markup=kb)
        
    elif d.startswith("reg_"):
        region = d.split("_")[1]
        region_name = REGIONS.get(region, region)
        msg = await m.reply_text(f"⏳ Новости: {region_name}...")
        search_data = await search_fast(f"чай {region_name} новости урожай 2025")
        answer = await ask_hf_fast(f"Краткие новости о чае из региона {region_name}. Данные: {search_data}")
        await msg.edit_text(f"{answer}\n\n📰 Региональные источники")
        
    elif d in ["ship", "stats"]:
        msg = await m.reply_text(" Статистика...")
        search_data = await search_fast("поставки чая в Россию 2025 импорт ФТС тонны")
        answer = await ask_hf_fast(f"Статистика импорта чая в Россию: объёмы, поставщики. Данные: {search_data}")
        await msg.edit_text(f"{answer}\n\n️ ФТС / Открытые данные")
        
    elif d == "price":
        ctx.user_data["mode"] = "price"
        await m.reply_text("💰 Напишите название чая:")

async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await menu(update, ctx)

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
    await app['app'].bot.set_webhook(WEBHOOK_URL)
    logger.info(f"✅ Bot running! @{app['app'].bot.username}")

async def on_shutdown(app):
    await app['app'].stop()
    await app['app'].shutdown()

def main():
    logger.info("🚀 Starting fast bot...")
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

