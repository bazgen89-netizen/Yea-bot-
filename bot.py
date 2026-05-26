#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍵 Tea Expert Bot — Groq версия
"""
import os, asyncio, logging, time
from aiohttp import web, ClientSession
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
   Application, CommandHandler, MessageHandler,
   CallbackQueryHandler, filters, ContextTypes
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
WEBHOOK_URL = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
PORT = int(os.getenv("PORT", 8080))

if not TELEGRAM_BOT_TOKEN:
   raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")

REGIONS = {
   "yunnan": "Юньнань (Пуэр)",
   "fujian": "Фуцзянь (Улуны)",
   "zhejiang": "Чжэцзян (Лунцзин)",
   "anhui": "Аньхой (Красный чай)",
   "sichuan": "Сычуань (Зелёный)",
   "hunan": "Хунань (Чёрный чай)"
}

CACHE_MAX_SIZE = 200
search_cache: dict = {}


def _clean_cache():
   if len(search_cache) > CACHE_MAX_SIZE:
       now = time.time()
       expired = [k for k, (t, _) in search_cache.items() if now - t > 300]
       for k in expired:
           del search_cache[k]
       if len(search_cache) > CACHE_MAX_SIZE:
           oldest = sorted(search_cache.items(), key=lambda x: x[1][0])
           for k, _ in oldest[:50]:
               del search_cache[k]


async def ask_ai(prompt: str) -> str:
   if not GROQ_API_KEY:
       return "⚠️ AI отключён. Задайте GROQ_API_KEY в переменных окружения."

   headers = {
       "Authorization": f"Bearer {GROQ_API_KEY}",
       "Content-Type": "application/json"
   }
   payload = {
       "model": "llama-3.1-8b-instant",
       "messages": [
           {
               "role": "system",
               "content": (
                   "Ты эксперт по китайскому чаю с 20-летним опытом. "
                   "Отвечай коротко, конкретно и по делу на русском языке. "
                   "Используй факты о сортах, регионах, ценах, заваривании."
               )
           },
           {
               "role": "user",
               "content": prompt
           }
       ],
       "max_tokens": 400,
       "temperature": 0.3
   }

   try:
       async with ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
           async with session.post(
               "https://api.groq.com/openai/v1/chat/completions",
               headers=headers,
               json=payload
           ) as resp:
               if resp.status == 200:
                   data = await resp.json()
                   text = data["choices"][0]["message"]["content"].strip()
                   return text[:600] if text else "⚠️ Пустой ответ от AI."
               elif resp.status == 429:
                   logger.warning("Groq rate limit")
                   return "⚠️ Слишком много запросов. Подождите минуту."
               elif resp.status == 401:
                   logger.error("Groq: неверный токен")
                   return "⚠️ Неверный GROQ_API_KEY. Проверьте переменную окружения."
               else:
                   body = await resp.text()
                   logger.error(f"Groq статус {resp.status}: {body[:200]}")
                   return "⚠️ AI временно недоступен. Попробуйте позже."
   except asyncio.TimeoutError:
       logger.warning("Groq timeout")
       return "⚠️ AI не ответил вовремя. Попробуйте ещё раз."
   except Exception as e:
       logger.error(f"Groq ошибка: {e}")
       return "⚠️ Ошибка подключения к AI."


async def search_fast(q: str) -> str:
   if not SERPER_KEY:
       return ""

   cache_key = q.lower().strip()
   if cache_key in search_cache:
       cached_time, cached_data = search_cache[cache_key]
       if time.time() - cached_time < 300:
           return cached_data

   try:
       async with ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
           async with s.post(
               "https://google.serper.dev/search",
               headers={"X-API-KEY": SERPER_KEY},
               json={"q": q, "num": 3, "hl": "ru"}
           ) as r:
               if r.status == 200:
                   data = await r.json()
                   result = "\n".join([
                       f"• {i.get('title', '')}: {i.get('snippet', '')}"
                       for i in data.get("organic", [])[:3]
                   ])
                   _clean_cache()
                   search_cache[cache_key] = (time.time(), result)
                   return result
   except Exception as e:
       logger.warning(f"Поиск не удался: {e}")

   return ""


async def safe_edit(msg, text: str, update: Update = None):
   try:
       await msg.edit_text(text)
   except Exception as e:
       logger.warning(f"edit_text не удался: {e}")
       if update:
           try:
               await update.message.reply_text(text)
           except Exception as e2:
               logger.error(f"reply_text тоже не удался: {e2}")


async def fast_reply(update: Update, text: str):
   msg = await update.message.reply_text("⏳ Думаю...")
   start = time.time()

   search_data = await search_fast(text)

   if search_data:
       answer = await ask_ai(
           f"Вопрос о чае: {text}\n\nДанные из поиска:\n{search_data}\n\n"
           f"Дай краткий полезный ответ на русском."
       )
   else:
       answer = await ask_ai(f"Вопрос о чае: {text}")

   elapsed = time.time() - start
   source = "поиск + AI" if search_data else "AI"
   footer = f"\n\n⚡ {elapsed:.1f}сек | {source}"

   await safe_edit(msg, f"{answer}{footer}", update)


async def menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
   kb = InlineKeyboardMarkup([
       [
           InlineKeyboardButton("🫖 Заваривание", callback_data="brew"),
           InlineKeyboardButton("📰 Регионы", callback_data="news")
       ],
       [
           InlineKeyboardButton("🚢 Поставки РФ", callback_data="ship"),
           InlineKeyboardButton("💰 Цены", callback_data="price")
       ]
   ])
   await update.message.reply_text(
       "🍵 <b>Tea Expert Bot</b>\nВыберите раздел или задайте вопрос:",
       reply_markup=kb,
       parse_mode='HTML'
   )


async def debug_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
   lines = ["🔧 <b>Диагностика:</b>\n"]
   lines.append(f"🔑 GROQ_API_KEY: {'✅ задан' if GROQ_API_KEY else '❌ не задан'}")
   lines.append(f"🔑 SERPER_KEY: {'✅ задан' if SERPER_KEY else '⚠️ не задан'}\n")

   lines.append("🤖 <b>Groq AI:</b>")
   if GROQ_API_KEY:
       try:
           async with ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
               async with s.post(
                   "https://api.groq.com/openai/v1/chat/completions",
                   headers={
                       "Authorization": f"Bearer {GROQ_API_KEY}",
                       "Content-Type": "application/json"
                   },
                   json={
                       "model": "llama-3.1-8b-instant",
                       "messages": [{"role": "user", "content": "Скажи: ОК"}],
                       "max_tokens": 5
                   }
               ) as r:
                   if r.status == 200:
                       lines.append("  ✅ llama-3.1-8b работает!")
                   elif r.status == 401:
                       lines.append("  ❌ Неверный токен!")
                   elif r.status == 429:
                       lines.append("  ⚠️ Rate limit")
                   else:
                       body = await r.text()
                       lines.append(f"  ❌ Статус {r.status}: {body[:100]}")
       except asyncio.TimeoutError:
           lines.append("  ⏱ Таймаут")
       except Exception as e:
           lines.append(f"  💥 {str(e)[:60]}")
   else:
       lines.append("  ❌ Ключ не задан")

   lines.append("\n🔍 <b>Поиск Serper:</b>")
   if SERPER_KEY:
       try:
           async with ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as s:
               async with s.post(
                   "https://google.serper.dev/search",
                   headers={"X-API-KEY": SERPER_KEY},
                   json={"q": "чай", "num": 1}
               ) as r:
                   lines.append(
                       f"  {'✅ работает' if r.status == 200 else f'❌ статус {r.status}'}"
                   )
       except Exception as e:
           lines.append(f"  ❌ {str(e)[:50]}")
   else:
       lines.append("  ⚠️ Ключ не задан")

   await update.message.reply_text("\n".join(lines), parse_mode='HTML')


async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
   ctx.user_data.clear()
   await menu(update, ctx)


async def on_msg(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
   if not update.message or not update.message.text:
       return
   text = update.message.text.strip()

   if text.lower() in ["привет", "/start", "меню", "старт"]:
       ctx.user_data.clear()
       return await menu(update, ctx)

   if ctx.user_data.get("mode") == "price":
       ctx.user_data.pop("mode", None)
       msg = await update.message.reply_text("💰 Ищу цены...")
       search_data = await search_fast(
           f"купить {text} цена Россия ozon wildberries"
       )
       answer = await ask_ai(
           f"Найди информацию о цене на чай '{text}' в России. "
           f"Данные из поиска:\n{search_data}\n\n"
           f"Дай краткий ответ с примерными ценами."
       )
       await safe_edit(
           msg,
           f"{answer}\n\n💡 Проверяйте на маркетплейсах",
           update
       )
       return

   await fast_reply(update, text)


async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
   q = update.callback_query
   await q.answer()
   d, m = q.data, q.message

   if d == "brew":
       msg = await m.reply_text("⏳ Готовлю инструкцию...")
       data = await search_fast(
           "как заваривать китайский чай гайвань температура время"
       )
       answer = await ask_ai(
           f"Дай подробную инструкцию по завариванию китайского чая: "
           f"температура воды, время настаивания, количество чая, посуда. "
           f"Данные: {data}"
       )
       await safe_edit(msg, f"{answer}\n\n📖 Китайские техники заваривания")

   elif d == "news":
       kb = InlineKeyboardMarkup([
           [InlineKeyboardButton(name, callback_data=f"reg_{code}")]
           for code, name in REGIONS.items()
       ])
       await m.reply_text("🌍 Выберите регион Китая:", reply_markup=kb)

   elif d.startswith("reg_"):
       region = d.split("_")[1]
       region_name = REGIONS.get(region, region)
       msg = await m.reply_text(f"⏳ Информация: {region_name}...")
       data = await search_fast(
           f"чай {region_name} регион Китай сорта особенности"
       )
       answer = await ask_ai(
           f"Расскажи о чайном регионе {region_name}: "
           f"какие сорта производят, особенности климата и вкуса. "
           f"Данные: {data}"
       )
       await safe_edit(msg, f"{answer}\n\n📰 Регион: {region_name}")

   elif d in ["ship", "stats"]:
       msg = await m.reply_text("⏳ Загружаю статистику...")
       data = await search_fast(
           "импорт чая Россия 2024 2025 статистика тонны"
       )
       answer = await ask_ai(
           f"Расскажи о поставках чая в Россию: "
           f"откуда везут, объёмы, тренды. Данные: {data}"
       )
       await safe_edit(msg, f"{answer}\n\n🏛️ Данные по импорту РФ")

   elif d == "price":
       ctx.user_data["mode"] = "price"
       await m.reply_text("💰 Напишите название чая для поиска цены:")


async def handle_webhook(request):
   try:
       upd = Update.de_json(await request.json(), request.app['bot'])
       await request.app['ptb_app'].process_update(upd)
       return web.Response(text="OK")
   except Exception as e:
       logger.error(f"Webhook error: {e}")
       return web.Response(text="Error", status=500)


async def on_startup(app):
   ptb = app['ptb_app']
   await ptb.initialize()
   await ptb.start()
   full_url = f"{WEBHOOK_URL.rstrip('/')}/webhook"
   await ptb.bot.set_webhook(full_url)
   logger.info(f"✅ Бот запущен! @{ptb.bot.username}")
   logger.info(f"🔗 Webhook: {full_url}")
   logger.info("🤖 AI: Groq llama-3.1-8b-instant")


async def on_shutdown(app):
   ptb = app['ptb_app']
   await ptb.stop()
   await ptb.shutdown()


def main():
   logger.info("🚀 Запуск Tea Expert Bot (Groq)...")

   ptb = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
   ptb.add_handler(CommandHandler("start", start_cmd))
   ptb.add_handler(CommandHandler("debug", debug_cmd))
   ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
   ptb.add_handler(CallbackQueryHandler(on_cb))

   web_app = web.Application()
   web_app['bot'] = ptb.bot
   web_app['ptb_app'] = ptb
   web_app.router.add_post('/webhook', handle_webhook)
   web_app.on_startup.append(on_startup)
   web_app.on_shutdown.append(on_shutdown)

   web.run_app(web_app, host="0.0.0.0", port=PORT)


if __name__ == "__main__":
   main()
