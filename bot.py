#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Чайный Инсайдер — версия для GitHub Actions
Ищет новости без ограничения по времени
"""

import os
import sys
import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import aiohttp
from telegram import Bot
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
YOUR_TELEGRAM_ID = int(os.getenv("YOUR_TELEGRAM_ID", "0") or "0")
FIREWORKS_KEY = os.getenv("FIREWORKS_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "accounts/fireworks/models/kimi-k2p5"

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

def clean_reasoning(text: str) -> str:
    if not text:
        return ""
    lines = text.split('\n')
    clean_lines = []
    skip = False
    for line in lines:
        low = line.lower()
        if any(x in low for x in ["проверка:", "пользователь", "даны", "нужно", "reasoning", "thinking", "note:", "i need to", "<think>"]):
            skip = True
            continue
        if skip and line.strip() and not any(line.startswith(x) for x in ['-', '•', '*', '=', 'ЧАЙНЫЙ']):
            skip = False
        if not skip:
            clean_lines.append(line)
    result = '\n'.join(clean_lines)
    for marker in ['=', 'ЧАЙНЫЙ', 'БЕЛЫЕ ЧАИ', 'ЗЕЛЁНЫЕ ЧАИ']:
        start = result.find(marker)
        if start != -1:
            return result[start:].strip()
    return result.strip()

def format_search_results(results: list, max_snippet: int = 300) -> list:
    if not results or isinstance(results, str):
        return []
    banned = ['1688.com', 'taobao.com', 'tmall.com', 'jd.com', 'pinduoduo.com', 'alibaba.com', 'aliexpress.com', 'ebay.com', 'amazon.cn']
    filtered = [item for item in results if not any(x in item.get('link', '') for x in banned) and len(item.get('snippet', '')) > 40]
    return [{"title": item.get('title', '')[:100], "snippet": item.get('snippet', '')[:max_snippet], "link": item.get('link', '')} for item in filtered[:10]]

async def serper_search(query: str, num_results: int = 10, hl: str = "zh", gl: str = "cn") -> list:
    if not SERPER_KEY:
        logger.warning("Serper ключ не настроен")
        return []
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            # Убрали tbs — ищем без ограничения по времени
            data = {"q": query, "num": num_results, "hl": hl, "gl": gl}
            async with session.post("https://google.serper.dev/search", headers=headers, json=data) as resp:
                if resp.status != 200:
                    logger.error(f"Serper error {resp.status}")
                    return []
                result = await resp.json()
                return result.get("organic", [])
    except Exception as e:
        logger.error(f"Serper exception: {e}")
        return []

async def ask_fireworks(messages: list, max_tokens: int = 3000, temperature: float = 0.1, retries: int = 2) -> str | None:
    if not FIREWORKS_KEY:
        logger.error("Fireworks ключ не настроен")
        return None
    for attempt in range(retries + 1):
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=90)) as session:
                headers = {"Authorization": f"Bearer {FIREWORKS_KEY}", "Content-Type": "application/json"}
                data = {"model": MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature, "stream": False}
                async with session.post("https://api.fireworks.ai/inference/v1/chat/completions", headers=headers, json=data) as resp:
                    if resp.status == 429:
                        wait_time = (attempt + 1) * 5
                        logger.warning(f"Rate limit, жду {wait_time}с...")
                        await asyncio.sleep(wait_time)
                        continue
                    if resp.status != 200:
                        logger.error(f"Fireworks error {resp.status}")
                        return None
                    result = await resp.json()
                    content = result.get("choices", [{}])[0].get("message", {}).get("content")
                    return content.strip() if content else None
        except Exception as e:
            logger.error(f"Fireworks error: {e}")
            if attempt == retries:
                return None
    return None

async def agent_search_all() -> dict:
    queries = {
        "white_tea": "福鼎白茶 白毫银针 白牡丹 产量 品质 新闻",
        "green_tea": "西湖龙井 碧螺春 黄山毛峰 春茶 品质 产量 新闻",
        "oolong_light": "铁观音 台湾乌龙 冻顶 阿里山 品质 产量 新闻",
        "oolong_dark": "大红袍 武夷岩茶 肉桂 水仙 品质 产量 新闻",
        "puer_sheng": "云南普洱 生茶 古树茶 产量 品质 价格 新闻",
        "puer_shu": "普洱熟茶 渥堆 发酵 产量 品质 新闻",
        "red_tea": "滇红茶 祁门红茶 正山小种 产量 品质 新闻",
        "factory_dayi": "勐海茶厂 大益 产量 新品 质量",
        "factory_xiaguan": "下关茶厂 沱茶 产量 品质",
        "factory_chen": "陈升号 老班章 产量 品质",
        "factory_yulin": "雨林古树茶 古树 产量 品质",
        "factory_dianhong": "滇红集团 凤庆 红茶 产量 品质",
        "factory_qimen": "祁门红茶 产量 品质",
        "factory_fuding": "福鼎白茶 品品香 绿雪芽 产量 品质",
        "factory_longjing": "西湖龙井 狮峰 梅家坞 产量 品质",
        "climate_yunnan": "云南 气候 干旱 雨水 普洱茶 产量 影响",
        "climate_fujian": "福建 气候 雨水 铁观音 岩茶 白茶 产量 影响",
        "climate_zhejiang": "浙江 气候 气温 龙井茶 产量 影响",
        "climate_taiwan": "台湾 气候 台风 高山茶 产量 影响"
    }
    
    async def fetch_one(name: str, query: str):
        try:
            results = await serper_search(query, 10)
            await asyncio.sleep(0.2)
            return name, format_search_results(results)
        except Exception as e:
            logger.error(f"Ошибка в {name}: {e}")
            return name, []
    
    semaphore = asyncio.Semaphore(3)
    async def limited_fetch(name: str, query: str):
        async with semaphore:
            return await fetch_one(name, query)
    
    tasks = [limited_fetch(name, query) for name, query in queries.items()]
    results_list = await asyncio.gather(*tasks, return_exceptions=True)
    
    results = {}
    for item in results_list:
        if isinstance(item, tuple) and len(item) == 2:
            results[item[0]] = item[1]
    return results

async def agent_translate(raw_data: list, title: str) -> str | None:
    if not raw_data:
        return None
    snippets = [f"{item['title']}: {item['snippet'][:200]}" for item in raw_data[:5] if item.get('snippet') and len(item['snippet']) > 30]
    if not snippets:
        return None
    text = "\n".join(snippets)
    prompt = f"""Переведи и сократи новости на русском. Только факты.

ТЕМА: {title}

{text[:1500]}

ФОРМАТ:
- [Фабрика/регион] — [факт]
- [Качество] — [оценка]
- [Объёмы] — [данные]"""
    result = await ask_fireworks([{"role": "user", "content": prompt}], max_tokens=1000)
    return result if result and result not in ["ОШИБКА", "Пусто", "Таймаут"] else None

async def agent_build_digest(translated_blocks: dict, today: str) -> str | None:
    sep = "=" * 25
    all_text = "\n\n".join([f"{k}:\n{v}" for k, v in translated_blocks.items() if v])
    prompt = f"""Собери дайджест на русском из готовых блоков. Только факты.

ДАТА: {today}

БЛОКИ:
{all_text[:5000]}

ФОРМАТ:
{sep}
ЧАЙНЫЙ ИНСАЙДЕР | {today}
{sep}

[Обзор рынка — 2 абзаца]

{sep}
БЕЛЫЕ ЧАИ (白茶)
{sep}
[факты из white_tea]

{sep}
ЗЕЛЁНЫЕ ЧАИ (绿茶)
{sep}
[факты из green_tea]

{sep}
УЛУНЫ СВЕТЛЫЕ (轻发酵乌龙)
{sep}
[факты из oolong_light]

{sep}
УЛУНЫ ТЁМНЫЕ / ЯН ЧА (重发酵乌龙/岩茶)
{sep}
[факты из oolong_dark]

{sep}
ШЭН ПУЭР (生普洱)
{sep}
[факты из puer_sheng]

{sep}
ШУ ПУЭР (熟普洱)
{sep}
[факты из puer_shu]

{sep}
КРАСНЫЕ ЧАИ / ХУН ЧА (红茶)
{sep}
[факты из red_tea]

{sep}
ФАБРИКИ ПУЭРА
{sep}
[факты из factory_dayi, factory_xiaguan, factory_chen, factory_yulin]

{sep}
ФАБРИКИ КРАСНЫХ ЧАЕВ
{sep}
[факты из factory_dianhong, factory_qimen]

{sep}
ФАБРИКИ БЕЛЫХ ЧАЕВ
{sep}
[факты из factory_fuding]

{sep}
ФАБРИКИ ЗЕЛЁНЫХ ЧАЕВ
{sep}
[факты из factory_longjing]

{sep}
КЛИМАТ И УРОЖАЙ
{sep}
- Юньнань: [факты из climate_yunnan]
- Фуцзянь: [факты из climate_fujian]
- Чжэцзян: [факты из climate_zhejiang]
- Тайвань: [факты из climate_taiwan]

{sep}
ИСТОРИЯ: ОТ ШЭНЬ НУНА ДО НАШИХ ДНЕЙ
{sep}
- 2737 до н.э. — Шэнь Нун
- 618-907 — Тан
- 960-1279 — Сун
- 1368-1644 — Мин
- 1895 — Японцы на Тайване
- 1938 — Дяньхун
- 1973 — Шу Пуэр
- 2006 — Бум пуэра
- 2025 — Экология, цифра

Не выдумывай. Если нет данных — пропусти раздел."""
    return await ask_fireworks([{"role": "user", "content": prompt}], max_tokens=4000)

async def send_message(bot: Bot, chat_id: int, text: str):
    MAX_LEN = 4000
    parts = [text[i:i+MAX_LEN] for i in range(0, len(text), MAX_LEN)]
    for i, part in enumerate(parts, 1):
        header = f"📄 Часть {i}/{len(parts)}\n\n" if len(parts) > 1 else ""
        await bot.send_message(chat_id=chat_id, text=header + part, disable_web_page_preview=True)
        if len(parts) > 1:
            await asyncio.sleep(2)

async def run_digest():
    target = YOUR_TELEGRAM_ID
    if not target:
        logger.error("Telegram ID не настроен")
        return
    
    now_msk = datetime.now(ZoneInfo("Europe/Moscow"))
    today = now_msk.strftime("%d.%m.%Y")
    
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    await bot.send_message(chat_id=target, text=f"🍵 Старт — {now_msk.strftime('%H:%M')} МСК\n🔍 Ищу новости за всё время...")
    
    try:
        logger.info("🔍 Сбор данных...")
        data = await agent_search_all()
        total = sum(len(v) for v in data.values())
        logger.info(f"✅ Найдено {total} источников")
        await bot.send_message(chat_id=target, text=f"🔍 Найдено {total} источников\n🌐 Перевожу...")
        
        logger.info("🌐 Перевод...")
        keys = list(data.keys())
        translated = {}
        for i in range(0, len(keys), 2):
            batch = keys[i:i+2]
            tasks = [agent_translate(data[k], k) for k in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for k, r in zip(batch, results):
                if isinstance(r, str) and r.strip():
                    translated[k] = r
            await asyncio.sleep(1)
        logger.info(f"✅ Переведено {len(translated)} блоков")
        
        logger.info("📝 Сборка дайджеста...")
        digest = await agent_build_digest(translated, today)
        
        if digest and len(digest.strip()) > 100:
            clean_digest = clean_reasoning(digest)
            clean_digest += "\n\n" + "=" * 25 + "\n#чай #пуэр #улун #белыйчай #зелёныйчай #красныйчай #китай #фабрики"
            logger.info(f"✅ Готово: {len(clean_digest)} символов")
            await send_message(bot, target, clean_digest)
            await bot.send_message(chat_id=target, text="🎉 Дайджест готов!")
        else:
            await bot.send_message(chat_id=target, text="❌ Не удалось сформировать дайджест")
            
    except Exception as e:
        error_msg = f"❌ Ошибка: {type(e).__name__}: {str(e)[:300]}"
        logger.error(error_msg)
        await bot.send_message(chat_id=target, text=error_msg)

if __name__ == "__main__":
    asyncio.run(run_digest())

