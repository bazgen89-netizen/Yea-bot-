#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Waystea Tea Expert Bot — Исправленная версия
"""
import os, sys, asyncio, logging, datetime
from zoneinfo import ZoneInfo
from aiohttp import web

import aiohttp
from telegram import Bot, Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
YOUR_TELEGRAM_ID = int(os.getenv("YOUR_TELEGRAM_ID", "0") or "0")
FIREWORKS_KEY = os.getenv("FIREWORKS_KEY", "")
SERPER_KEY = os.getenv("SERPER_KEY", "")
MODEL = "accounts/fireworks/models/kimi-k2p5"

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

# --- Поиск информации ---

async def search_waystea(query):
    """Ищет информацию на waystea.ru и в чайных источниках"""
    if not SERPER_KEY:
        return "Ошибка: нет ключа Serper."
    
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
            headers = {"X-API-KEY": SERPER_KEY, "Content-Type": "application/json"}
            
            search_queries = [
                f"site:waystea.ru {query}",
                f"{query} tea china pu-erh oolong",
            ]
            
            all_context = ""
            
            for q in search_queries:
                data = {"q": q, "num": 5, "hl": "ru"}
                try:
                    async with session.post("https://google.serper.dev/search", headers=headers, json=data) as resp:
                        if resp.status == 200:
                            result = await resp.json()
                            organic = result.get("organic", [])
                            
                            for item in organic[:3]:
                                all_context += f"Источник: {item.get('title')}\nURL: {item.get('link')}\nИнформация: {item.get('snippet')}\n\n"
                except Exception as e:
                    logger.error(f"Search error for {q}: {e}")
                    continue
            
            return all_context if all_context else "Информация не найдена"
            
    except Exception as e:
        logger.error(f"Search exception: {e}")
        return f"Ошибка поиска: {e}"

async def ask_fireworks_expert(system_prompt, user_message, context=""):
    """Спрашивает AI с экспертной инструкцией"""
    if not FIREWORKS_KEY:
        return "Ошибка: нет ключа Fireworks."
    
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
            headers = {"Authorization": f"Bearer {FIREWORKS_KEY}", "Content-Type": "application/json"}
            
            full_user_message = f"""
КОНТЕКСТ ИЗ ИСТОЧНИКОВ:
{context}

ВОПРОС ПОЛЬЗОВАТЕЛЯ:
{user_message}

Отвечай на основе предоставленного контекста. Если информации недостаточно — скажи об этом честно."""
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": full_user_message}
            ]
            
            data = {
                "model": MODEL,
                "messages": messages,
                "max_tokens": 1500,
                "temperature": 0.4
            }
            
            async with session.post("https://api.fireworks.ai/inference/v1/chat/completions", headers=headers, json=data) as resp:
                if resp.status == 200:
                    res = await resp.json()
                    return res['choices'][0]['message']['content'].strip()
                else:
                    error_text = await resp.text()
                    return f"Ошибка AI: статус {resp.status}. {error_text}"
                    
    except Exception as e:
        logger.error(f"AI exception: {e}")
        return f"Ошибка AI: {e}"

def get_system_prompt(category):
    """Возвращает системный промпт в зависимости от категории вопроса"""
    
    base_prompt = """Ты — эксперт по чаю с многолетним опытом работы в компании Waystea.
Твоя специализация: китайский чай (пуэр, улун, красный, зеленый, белый чай).
Ты отвечаешь ПРАВДИВО, профессионально, но доступно.
Всегда ссылайся на источники, если они есть."""

    if category == "brewing":
        return base_prompt + """
Фокус на заваривании:
- Указывай температуру воды (°C)
- Время пролива (секунды/минуты)
- Количество чая на объем воды
- Тип посуды (гайвань, исинский чайник и т.д.)
- Особенности для конкретного чая"""
    
    elif category == "storage":
        return base_prompt + """
Фокус на хранении чая:
- Условия (влажность, температура, свет)
- Срок хранения
- Как правильно хранить разные виды чая
- Признаки правильного/неправильного хранения"""
    
    elif category == "selection":
        return base_prompt + """
Фокус на подборе чая:
- Спрашивай предпочтения (вкус, эффект, бюджет)
- Предлагай варианты с описанием
- Указывай особенности вкуса и аромата
- Давай рекомендации по завариванию"""
    
    elif category == "history":
        return base_prompt + """
Фокус на истории и происхождении:
- Регион производства
- История создания чая
- Традиции и особенности
- Легенды и факты"""
    
    else:
        return base_prompt + """
Отвечай как универсальный эксперт:
- Давай точную информацию
- Если не знаешь — признайся
- Предлагай уточнить вопрос
- Будь полезен и дружелюбен"""

async def classify_question(user_text):
    """Определяет тип вопроса для выбора правильного промпта"""
    text_lower = user_text.lower()
    
    if any(word in text_lower for word in ["как заваривать", "заварка", "температура", "пролив", "гайвань", "чайник"]):
        return "brewing"
    elif any(word in text_lower for word in ["хранить", "хранение", "срок", "влажность", "испортился"]):
        return "storage"
    elif any(word in text_lower for word in ["выбрать", "подобрать", "рекомендуй", "совет", "какой лучше", "купить"]):
        return "selection"
    elif any(word in text_lower for word in ["история", "происхождение", "откуда", "легенда", "традиция"]):
        return "history"
    else:
        return "general"

# --- ОБРАБОТКА СООБЩЕНИЙ ---

async def handle_user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обрабатывает ЛЮБЫЕ текстовые сообщения от пользователей"""
    try:
        user_text = update.message.text
        chat_id = update.effective_chat.id
        user_name = update.effective_user.first_name
        
        logger.info(f"📨 Получено сообщение от {user_name} (ID: {chat_id}): {user_text[:50]}")
        
        # Показываем что работаем
        thinking_msg = await update.message.reply_text("🔍 Ищу информацию...")
        
        # Классифицируем вопрос
        category = await classify_question(user_text)
        logger.info(f"📂 Категория: {category}")
        
        # Ищем информацию
        search_context = await search_waystea(user_text)
        logger.info(f"📚 Найдено контекста: {len(search_context)} символов")
        
        # Получаем промпт
        system_prompt = get_system_prompt(category)
        
        # Запрашиваем ответ у AI
        logger.info("🤔 Запрашиваю ответ у AI...")
        answer = await ask_fireworks_expert(system_prompt, user_text, search_context)
        logger.info(f"✅ Получен ответ: {len(answer)} символов")
        
        # Удаляем сообщение "думаю"
        await thinking_msg.delete()
        
        # Добавляем подпись
        footer = "\n\n━━━━━━━━━━━━\nℹ️ Информация предоставлена на основе Waystea и проверенных источников"
        full_answer = answer + footer
        
        # Отправляем ответ (разбиваем если длинный)
        for i in range(0, len(full_answer), 4000):
            await update.message.reply_text(full_answer[i:i+4000])
            await asyncio.sleep(0.5)
            
        logger.info(f"✅ Ответ отправлен пользователю {user_name}")
        
    except Exception as e:
        logger.error(f"❌ Ошибка в handle_user_message: {e}")
        try:
            await update.message.reply_text(f"❌ Произошла ошибка: {str(e)[:100]}")
        except:
            pass

# --- Команды ---

async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info(f"👋 Команда /start от {update.effective_user.first_name}")
    await update.message.reply_text(
        "🍵 <b>Waystea Tea Expert</b>\n\n"
        "Я — ваш персональный эксперт по чаю на основе знаний Waystea.\n\n"
        "<b>Что я умею:</b>\n"
        "• 📚 Рассказать о любом чае (пуэр, улун, красный, зеленый)\n"
        "• 🫖 Научить правильно заваривать\n"
        "• 💾 Подсказать как хранить чай\n"
        "• 🎯 Помочь выбрать чай под ваш вкус\n"
        "• 🏔️ Поделиться историей и происхождением\n\n"
        "<b>Просто напишите:</b>\n"
        "«Как заваривать шу пуэр?»\n"
        "«Посоветуй улун для начинающих»\n"
        "«История Да Хун Пао»\n\n"
        "Готов ответить на ваши вопросы!",
        parse_mode='HTML'
    )

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📖 <b>Примеры вопросов:</b>\n\n"
        "🔸 <i>Как заваривать шен пуэр?</i>\n"
        "🔸 <i>Чем отличается шу от шен?</i>\n"
        "🔸 <i>Как хранить пуэр дома?</i>\n"
        "🔸 <i>Какой улун самый ароматный?</i>\n"
        "🔸 <i>Что такое Да Хун Пао?</i>\n"
        "🔸 <i>Рекомендуй чай для утра</i>\n\n"
        "Спрашивайте что угодно о чае!"
    )

# --- Webhook ---

async def handle_webhook(request):
    try:
        update = Update.de_json(await request.json(), request.app['bot'])
        if update and update.effective_chat:
            logger.info(f"📨 Webhook: получено обновление от {update.effective_chat.id}")
        await request.app['application'].process_update(update)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"❌ Webhook error: {e}")
        return web.Response(text="Error", status=500)

async def on_startup(app):
    """Инициализация при запуске"""
    application = app['application']
    await application.initialize()
    await application.start()
    
    webhook_url = os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com")
    await application.bot.set_webhook(webhook_url)
    logger.info(f"✅ Webhook установлен: {webhook_url}")
    logger.info("✅ Waystea Expert Bot запущен и готов к работе!")
    logger.info("📱 Теперь бот отвечает на сообщения пользователей!")

async def on_shutdown(app):
    """Остановка при завершении"""
    application = app['application']
    await application.stop()
    await application.shutdown()

def main():
    logger.info("🚀 Запуск Waystea Tea Expert Bot...")
    
    application = Applicati
    on.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Команды
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("help", help_cmd))
    
    # ГЛАВНОЕ: Обработчик ВСЕХ текстовых сообщений
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_user_message))
    logger.info("✅ Добавлен обработчик текстовых сообщений")
    
    # Web-сервер
    web_app = web.Application()
    web_app['bot'] = application.bot
    web_app['application'] = application
    web_app.router.add_post('/', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    
    logger.info("✅ Запуск web-сервера...")
    web.run_app(web_app, host='0.0.0.0', port=int(os.getenv('PORT', 8080)))

if __name__ == "__main__":
    main()

