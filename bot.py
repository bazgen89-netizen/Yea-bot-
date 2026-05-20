#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Чайный Инсайдер — Версия для Render (Webhook)
"""
import os, sys, asyncio, logging, datetime
from zoneinfo import ZoneInfo
from aiohttp import web

import aiohttp
from telegram import Bot, Update
from telegram.ext import Application, CommandHandler, ContextTypes
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
YOUR_TELEGRAM_ID = int(os.getenv("YOUR_TELEGRAM_ID", "0") or "0")
FIREWORKS_KEY = os.getenv("FIREWORKS_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "accounts/fireworks/models/kimi-k2p5"

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

# --- Вспомогательные функции ---

def clean_reasoning(text):
    if not text: 
        return ""
    lines = text.split('\n')
    clean_lines, skip = [], False
    for line in lines:
        low = line.lower()
        if any(x in low for x in ["проверка:", "reasoning", "thinking", "<think>"]): 
            skip = True
            continue
        if skip and line.strip() and not any(line.startswith(x) for x in ['-', '•', '*', '=', '']): 
            skip = False
        if not skip: 
            clean_lines.append(line)
    return '\n'.join(clean_lines).strip()

def format_search_results(results, max_snippet=300):
    if not results: 
        return []
    banned = ['taobao', '1688', 'jd.com', 'alibaba']
    filtered = [i for i in results if not any(x in i.get('link','') for x in banned) and len(i.get('snippet','')) > 40]
    return [{"title": i['title'][:100], "snippet": i['snippet'][:max_snippet], "link": i.get('link', '')} for i in filtered[:10]]

async def serper_search(query, num=10):
    if not SERPER_KEY: 
        logger.error("❌ SERPER_KEY не настроен!")
        return []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            data = {"q": query, "num": num}
            async with s.post("https://google.serper.dev/search", headers=headers, json=data) as r:
                if r.status != 200:
                    logger.error(f"Serper error: {r.status}")
                    return []
                result = await r.json()
                organic = result.get("organic", [])
                logger.info(f"🔍 Найдено {len(organic)} результатов для: {query[:50]}")
                return organic
    except Exception as e:
        logger.error(f"Serper exception: {e}")
        return []

async def ask_fireworks(messages, max_tokens=2000):
    if not FIREWORKS_KEY: 
        logger.error("❌ FIREWORKS_KEY не настроен!")
        return None
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as s:
            headers = {"Authorization": f"Bearer {FIREWORKS_KEY}", "Content-Type": "application/json"}
            async with s.post("https://api.fireworks.ai/inference/v1/chat/completions", headers=headers, json={"model": MODEL, "messages": messages, "max_tokens": max_tokens}) as r:
                if r.status != 200:
                    logger.error(f"Fireworks error: {r.status}")
                    return None
                res = await r.json()
                return res['choices'][0]['message']['content'].strip() if res.get('choices') else None
    except Exception as e:
        logger.error(f"Fireworks exception: {e}")
        return None

# --- Логика бота ---

async def agent_search_all():
    # Используем более простые запросы на русском и английском
    queries = {
        "white_tea": "white tea news 2025 2026", 
        "green_tea": "green tea China news 2025",
        "oolong": "oolong tea news", 
        "puer": "pu-erh tea news 2025",
        "red_tea": "black tea China news", 
        "factories": "Dayi tea factory news"
    }
    
    async def fetch(n, q):
        try:
            res = await serper_search(q, 8)
            formatted = format_search_results(res)
            logger.info(f"✅ {n}: {len(formatted)} новостей")
            return n, formatted
        except Exception as e:
            logger.error(f"Error fetching {n}: {e}")
            return n, []
    
    tasks = [fetch(n, q) for n, q in queries.items()]
    results = await asyncio.gather(*tasks)
    return {n: r for n, r in results if r}

async def agent_build_digest(data, today):
    sep = "━" * 25
    blocks = []
    total_news = 0
    
    for k, v in data.items():
        if v:
            total_news += len(v)
            snippets = "\n".join([f"• {i['title']}" for i in v[:3]])
            blocks.append(f"**{k}**:\n{snippets}")
    
    logger.info(f"📊 Всего найдено новостей: {total_news}")
    
    if not blocks: 
        return None
    
    # Если новостей мало, просто вернём их без AI
    if total_news < 3:
        simple_digest = f"{sep}\n🍵 ЧАЙНЫЙ ИНСАЙДЕР | {today}\n{sep}\n\n"
        for k, v in data.items():
            if v:
                simple_digest += f"\n**{k}**:\n"
                for item in v[:5]:
                    simple_digest += f"• {item['title']}\n"
                    if item.get('link'):
                        simple_digest += f"  {item['link']}\n"
        simple_digest += f"\n{sep}"
        return simple_digest
    
    # Используем AI для форматирования
    prompt = f"""Собери дайджест новостей чая на русском. Только факты.

ДАТА: {today}

НОВОСТИ:
{"\n\n".join(blocks)}

ФОРМАТ:
{sep}
🍵 ЧАЙНЫЙ ИНСАЙДЕР | {today}
{sep}

[Сводка по категориям]

{sep}
История: 2737 до н.э. — Шэнь Нун, 1973 — Шу Пуэр, 2025 — Экология.
{sep}"""
    
    return await ask_fireworks([{"role": "user", "content": prompt}], max_tokens=3000)

async def run_digest(chat_id=None):
    target = chat_id or YOUR_TELEGRAM_ID
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    today = datetime.datetime.now(ZoneInfo("Europe/Moscow")).strftime("%d.%m.%Y")
    
    try:
        if chat_id:
            await bot.send_message(chat_id=target, text="⏳ Собираю свежие новости... (5-10 мин)")
        
        logger.info("🔍 Начало сбора данных...")
        data = await agent_search_all()
        total = sum(len(v) for v in data.values())
        logger.info(f"✅ Всего найдено: {total} новостей")
        
        if total == 0:
            msg = "ℹ️ Новостей не найдено. Проверьте API ключи."
            logger.warning(msg)
            if chat_id:
                await bot.send_message(chat_id=target, text=msg)
            return
        
        digest = await agent_build_digest(data, today)
        
        if digest and len(digest.strip()) > 50:
            clean = clean_reasoning(digest)
            logger.info(f"📤 Отправка дайджеста ({len(clean)} символов)")
            
            for i in range(0, len(clean), 4000):
                await bot.send_message(chat_id=target, text=clean[i:i+4000])
                await asyncio.sleep(1)
                
            if chat_id: 
                await bot.send_message(chat_id=target, text="✅ Готово!")
        else:
            msg = "ℹ️ Не удалось обработать новости"
            logger.warning(msg)
            if chat_id: 
                await bot.send_message(chat_id=target, text=msg)
            
    except Exception as e:
        error_msg = f"❌ Ошибка: {str(e)[:200]}"
        logger.error(error_msg)
        if chat_id: 
            await bot.send_message(chat_id=target, text=error_msg)

# --- Задачи по расписанию ---

async def daily_job(context: ContextTypes.DEFAULT_TYPE):
    logger.info("🕒 Авто-запуск дайджеста (15:00 МСК)")
    await run_digest()

# --- Команды ---

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🍵 <b>Чайный Инсайдер</b>\n\n"
        "/new — Получить свежие новости прямо сейчас\n"
        "Авто-рассылка: ежедневно в 15:00 МСК",
        parse_mode='HTML'
    )

async def new_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("⏳ Начинаю сбор новостей...")
    asyncio.create_task(run_digest(update.effective_chat.id))

# --- Webhook обработчик ---

async def handle_webhook(request):
    try:
        update = Update.de_json(await request.json(), request.app['bot'])
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    """Инициализация при запуске"""
    application = app['application']
    await application.initialize()
    await application.start()
    
    # Устанавливаем webhook
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await application.bot.set_webhook(webhook_url)
    logger.info(f"✅ Webhook установлен: {webhook_url}")
    logger.info("✅ Бот запущен и готов к работе!")

async def on_shutdown(app):
    """Остановка при завершении"""
    application = app['application']
    await application.stop()
    await application.shutdown()

def main():
    logger.info("🚀 Запуск бота (Webhook режим)...")
    
    # Создаем приложение
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Добавляем обработчики
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("new", new_cmd))
    
    # Авто-запуск в 15:00 МСК (12:00 UTC)
    application.job_queue.run_daily(daily_job, time=datetime.time(hour=12, minute=0))
    logger.info("⏰ Авто-отправка настроена на 12:00 UTC (15:00 МСК)")
    
    # Создаем web-приложение
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['application'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    # Запускаем web-сервер
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

