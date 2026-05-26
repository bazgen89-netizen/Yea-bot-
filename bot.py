#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — Надёжная версия (с резервом)
"""
import os, asyncio, logging, time, random
from aiohttp import web, ClientSession, TCPConnector
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

# 🔄 Несколько моделей на выбор (если одна не работает)
HF_MODELS = [
    "mistralai/Mistral-7B-Instruct-v0.2",  # Стабильная
    "microsoft/Phi-3-mini-4k-instruct",     # Быстрая
    "google/gemma-2b-it"                     # Резервная
]
CURRENT_MODEL_IDX = 0

REGIONS = {
    "yunnan": "Юньнань (Пуэр)",
    "fujian": "Фуцзянь (Улуны)",
    "zhejiang": "Чжэцзян (Лунцзин)",
    "anhui": "Аньхой (Красный чай)",
    "sichuan": "Сычуань (Зелёный)",
    "hunan": "Хунань (Чёрный чай)"
}

search_cache = {}

async def ask_hf_robust(prompt: str) -> str:
    """Запрос к HF с повторными попытками и сменой модели"""
    global CURRENT_MODEL_IDX
    
    if not HF_TOKEN or HF_TOKEN.startswith("hf_x"):
        return "⚠️ AI отключён. Настройте HF_TOKEN."
    
    # Пробуем 2-3 модели если первая не работает
    for attempt in range(3):
        model = HF_MODELS[(CURRENT_MODEL_IDX + attempt) % len(HF_MODELS)]
        
        headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"}
        # Упрощённый промпт для скорости
        payload = {
            "inputs": f"<s>[INST] Ты эксперт по чаю. Отвечай коротко на русском. {prompt} [/INST]",
            "parameters": {"max_new_tokens": 400, "temperature": 0.3, "return_full_text": False}
        }
        
        try:
            # Создаём сессию с правильными настройками DNS
            connector = TCPConnector(ttl_dns_cache=300, limit=10)
            async with ClientSession(connector=connector, timeout=aiohttp.ClientTimeout(total=35)) as session:
                url = f"https://api-inference.huggingface.co/models/{model}"
                async with session.post(url, headers=headers, json=payload) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        if result and len(result) > 0:
                            CURRENT_MODEL_IDX = (CURRENT_MODEL_IDX + attempt) % len(HF_MODELS)
                            return result[0].get('generated_text', '').strip()[:500]
                    elif resp.status == 503:
                        await asyncio.sleep(2)  # Ждём пока модель загрузится
                        continue
                    elif resp.status == 429:
                        await asyncio.sleep(3)  # Rate limit
                        continue
        except asyncio.TimeoutError:
            logger.warning(f"Timeout for model {model}")
            continue
        except Exception as e:
            logger.warning(f"Model {model} failed: {e}")
            continue
    
    # Если все модели не сработали — отвечаем без AI
    return "⚠️ AI временно недоступен. Попробуйте через минуту или задайте другой вопрос."

async def search_fast(q: str) -> str:
    """Поиск с кэшем"""
    if not SERPER_KEY: return ""
    
    cache_key = q.lower().strip()
    if cache_key in search_cache:
        cached_time, cached_data = search_cache[cache_key]
        if time.time() - cached_time < 300:
            return cached_data
    
    try:
        async with ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
            async with s.post("https://google.serper.dev/search", 
                            headers={"X-API-KEY": SERPER_KEY}, 
                            json={"q": q, "num": 2, "hl": "ru"}) as r:
                if r.status == 200:
                    data = await r.json()
                    result = "\n".join([f"• {i.get('title', '')}" for i in data.get("organic", [])[:2]])
                    search_cache[cache_key] = (time.time(), result)
                    return result
    except: pass
    return ""

async def fast_reply(update: Update, text: str):
    """Быстрый ответ с индикатором"""
    msg = await update.message.reply_text("⏳ Ищу...")
    
    start = time.time()
    search_data = await search_fast(text)
    
    # Если поиск дал результат — используем AI
    if search_data:
        answer = await ask_hf_robust(f"Вопрос: {text}\nКонтекст: {search_data}")
    else:
        # Если поиска нет — отвечаем сами
        answer = await ask_hf_robust(f"Ответь на вопрос о чае: {text}")
    
    elapsed = time.time() - start
    footer = f"\n\n⚡ {elapsed:.1f}сек | Источники: поиск"
    
    try:
        await msg.edit_text(f"{answer}{footer}")
    except:
        await update.message.reply_text(f"{answer}\n\n⚡ {elapsed:.1f}сек")

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
        msg = await update.message.reply_text("💰 Ищу цены...")
        search_data = await search_fast(f"купить {text} цена Россия ozon wildberries avito")
        answer = await ask_hf_robust(f"Найди минимальную цену на {text} в России. Данные: {search_data}")
        await msg.edit_text(f"{answer}\n\n💡 Проверяйте на маркетплейсах")
        return

    await fast_reply(update, text)

async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    d, m = q.data, q.message
    
    if d == "brew":
        msg = await m.reply_text("⏳ Готовлю инструкцию...")
        data = await search_fast("как заваривать китайский чай гайвань температура время")
        answer = await ask_hf_robust(f"Инструкция по завариванию: температура, время, пропорции. Данные: {data}")
        await msg.edit_text(f"{answer}\n\n📖 Китайские гайды")
        
    elif d == "news":
        kb = InlineKeyboardMarkup([[InlineKeyboardButton(name, callback_data=f"reg_{code}")] for code, name in REGIONS.items()])
        await m.reply_text("🌍 Выберите регион:", reply_markup=kb)
        
    elif d.startswith("reg_"):
        region = d.split("_")[1]
        region_name = REGIONS.get(region, region)
        msg = await m.reply_text(f"⏳ Новости: {region_name}...")
        data = await search_fast(f"чай {region_name} новости урожай 2025 2026")
        answer = await ask_hf_robust(f"Новости чая из {region_name}. Данные: {data}")
        await msg.edit_text(f"{answer}\n\n📰 Региональные источники")
        
    elif d in ["ship", "stats"]:
        msg = await m.reply_text("⏳ Статистика...")
        data = await search_fast("поставки чая в Россию 2025 импорт ФТС тонны")
        answer = await ask_hf_robust(f"Статистика импорта чая в РФ. Данные: {data}")
        await msg.edit_text(f"{answer}\n\n🏛️ ФТС / Открытые данные")
        
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
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    await app['app'].initialize()
    await app['app'].start()
    await app['app'].bot.set_webhook(WEBHOOK_URL)
    logger.info(f"✅ Bot running! @{app['app'].bot.username}")
    logger.info(f"🤖 Using HF models: {[m.split('/')[1] for m in HF_MODELS]}")

async def on_shutdown(app):
    await app['app'].stop()
    await app['app'].shutdown()

def main():
    logger.info("🚀 Starting robust bot...")
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

