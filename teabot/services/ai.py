"""Клиент Groq (OpenAI-совместимый chat completions API)."""
import asyncio
import logging

import aiohttp

from ..config import AI_TIMEOUT, DEBUG_AI_TIMEOUT, AI_ANSWER_MAX_LEN
from ..constants import AI_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class GroqClient:
    def __init__(self, api_key: str, model: str, session: aiohttp.ClientSession):
        self.api_key = api_key
        self.model = model
        self.session = session

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def ask(self, prompt: str, system: str = "") -> str:
        """system позволяет сменить роль модели (например, ответы в соцсетях)."""
        if not self.api_key:
            return "⚠️ AI отключён. Задайте GROQ_API_KEY в переменных окружения."

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system or AI_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 1500,
            "temperature": 0.3,
        }

        try:
            async with self.session.post(
                GROQ_URL,
                headers=self._headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=AI_TIMEOUT),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    text = data["choices"][0]["message"]["content"].strip()
                    return text[:AI_ANSWER_MAX_LEN] if text else "⚠️ Пустой ответ от AI."
                elif resp.status == 429:
                    return "⚠️ Слишком много запросов. Подождите минуту."
                elif resp.status == 401:
                    return "⚠️ Неверный GROQ_API_KEY."
                else:
                    body = await resp.text()
                    logger.error(f"Groq статус {resp.status}: {body[:200]}")
                    return "⚠️ AI временно недоступен. Попробуйте позже."
        except asyncio.TimeoutError:
            return "⚠️ AI не ответил вовремя. Попробуйте ещё раз."
        except Exception as e:
            logger.error(f"Groq ошибка: {e}")
            return "⚠️ Ошибка подключения к AI."

    async def health_check(self) -> str:
        """Проверка доступности Groq для /debug."""
        if not self.api_key:
            return "❌ Ключ не задан"
        try:
            async with self.session.post(
                GROQ_URL,
                headers=self._headers,
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": "Скажи: ОК"}],
                    "max_tokens": 5,
                },
                timeout=aiohttp.ClientTimeout(total=DEBUG_AI_TIMEOUT),
            ) as r:
                if r.status == 200:
                    return f"✅ {self.model} работает!"
                elif r.status == 401:
                    return "❌ Неверный токен!"
                elif r.status == 429:
                    return "⚠️ Rate limit"
                else:
                    body = await r.text()
                    return f"❌ Статус {r.status}: {body[:100]}"
        except asyncio.TimeoutError:
            return "⏱ Таймаут"
        except Exception as e:
            return f"💥 {str(e)[:60]}"
