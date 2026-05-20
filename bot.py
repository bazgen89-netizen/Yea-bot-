#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Чайный Инсайдер — Версия для Render (с JobQueue)
"""
import os, sys, asyncio, logging, datetime
from zoneinfo import ZoneInfo

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
    if not text: return ""
    lines = text.split('\n')
    clean_lines, skip = [], False
    for line in lines:
        low = line.lower()
        if any(x in low for x in ["проверка:", "reasoning", "thinking", "<think>"]): skip = True; continue
        if skip and line.strip() and not any(line.startswith(x) for x in ['-', '•', '*', '=', '']): skip = False
        if not skip: clean_lines.append(line)
    return '\n'.join(clean_lines).strip()

def format_search_results(results, max_snippet=300):
    if not results: return []
    banned = ['taobao', '1688', 'jd.com', 'alibaba']
    filtered = [i for i in results if not any(x in i.get('link','') for x in banned) and len(i.get('snippet','')) > 40]
    return [{"title": i['title'][:100], "snippet": i['snippet'][:max_snippet]} for i in filtered[:10]]

async def serper_search(query, num=10):
    if not SERPER_KEY: return []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
            async with s.post("https://google.serper.dev/search", headers={"X-API-KEY": SERPER_KEY}, json={"q": query, "num": num}) as r:
                return (await r.json()).get("organic", []) if r.status == 200 else []
    except: return []

async def ask_fireworks(messages, max_tokens=2000):
    if not FIREWORKS_KEY: return None
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as s:
            headers = {"Authorization": f"Bearer {FIREWORKS_KEY}", "Content-Type": "application/json"}
            async with s.post("https://api.fireworks.ai/inference/v1/chat/completions", headers=headers, json={"model": MODEL, "messages": messages, "max_tokens": max_tokens}) as r:
                res = await r.json()
                return res['choices'][0]['message']['content'].strip() if res.get('choices') else None
    except: return None

# --- Логика бота ---
async def agent_search_all():
    queries = {
        "white_tea": "福鼎白茶 2025 新闻", "green_tea": "西湖龙井 2025 新闻",
        "oolong": "大红袍 铁观音 2025 新闻", "puer": "云南普洱 古树茶 2025 新闻",
        "red_tea": "滇红 祁门红茶 2025 新闻", "factories": "大益 陈升号 2025 新闻"
    }
    async def fetch(n, q):
        try:
            res = await serper_search(q, 8)
            return n, format_search_results(res)
        except: return n, []
    
    tasks = [fetch(n, q) for n, q in queries.items()]
    results = await asyncio.gather(*tasks)
    return {n: r for n, r in results if r}

async def agent_build_digest(data, today):
    sep = "━" * 25
    blocks = []
    for k, v in data.items():
        if v:
            snippets = "\n".join([f"• {i['title']}: {i['snippet'][:150]}" for i in v[:3]])
            blocks.append(f"**{k}**:\n{snippets}")
    
    if not blocks: return None
    
    prompt = f"Собери дайджест новостей чая на русском. Только факты.\n\nДАТА: {today}\n\nНОВОСТИ:\n" + "\n\n".join(blocks) + f"\n\nФОРМАТ:\n{sep}\n🍵 ЧАЙНЫЙ ИНСАЙДЕР | {today}\n{sep}\n\n[Сводка по категориям]\n\n{sep}\n История: 2737 до н.э. — Шэнь Нун, 1973 — Шу Пуэр, 2025 — Экология.\n{sep}"
    
    return await ask_fireworks([{"role": "user", "content": prompt}], max_tokens=3000)

async def run_digest(chat_id=None):
    target = chat_id or YOUR_TELEGRAM_ID
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    today = datetime.datetime.now(ZoneInfo("Europe/Moscow")).strftime("%d.%m.%Y")
    
    try:
        if chat_id:
            await bot.send_message(chat_id=target, text="⏳ Собираю свежие новости... (5-10 мин)")
        
        data = await agent_search_all()
        digest = await agent_build_digest(data, today)
        
        if digest:
            clean = clean_reasoning(digest)
            for i in range(0, len(clean), 4000):
                await bot.send_message(chat_id=target, text=clean[i:i+4000])
            if chat_id: await bot.send_message(chat_id=target, text="✅ Готово!")
        else:
            if chat_id: await bot.send_message(chat_id=target, text="ℹ️ Новых новостей нет")
            
    except Exception as e:
        if chat_id: await bot.send_message(chat_id=target, text=f"❌ Ошибка: {str(e)[:100]}")

# --- Задачи по расписанию (Встроенный JobQueue) ---
async def daily_job(context: ContextTypes.DEFAULT_TYPE):
    logger.info("🕒 Авто-запуск дайджеста (15:00 МСК)")
    await run_digest() # Отправит на YOUR_TELEGRAM_ID

# --- Команды ---
async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🍵 <b>Чайный Инсайдер</b>\n\n"
        "/new — Получить свежие новости прямо сейчас\n"
        "Авто-рассылка: ежедневно в 15:00 МСК",
        parse_mode='HTML'
    )

async def new_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    asyncio.create_task(run_digest(update.effective_chat.id))

async def main():
    logger.info("🚀 Запуск бота (24/7 режим)...")
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    app.add_handler(CommandHandler("start", start_cmd))
    app.add_handler(CommandHandler("new", new_cmd))
    
    # Настройка расписания: 15:00 МСК = 12:00 UTC
    app.job_queue.run_daily(daily_job, time=datetime.time(hour=12, minute=0))
    logger.info(" Авто-отправка настроена на 12:00 UTC (15:00 МСК)")
    
    await app.run_polling()

if __name__ == "__main__":
    asyncio.run(main())

