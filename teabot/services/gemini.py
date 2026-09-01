"""Клиент Google Gemini — второй мозг бота.

Тот же интерфейс, что у GroqClient (ask/health_check), поэтому обработчики
и хаб соцсетей не знают, какой моделью получен ответ.
"""
import asyncio
import logging

import aiohttp

from ..config import AI_TIMEOUT, DEBUG_AI_TIMEOUT, AI_ANSWER_MAX_LEN
from ..constants import AI_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiClient:
    name = "Gemini"

    def __init__(self, api_key: str, model: str, session: aiohttp.ClientSession):
        self.api_key = api_key
        self.model = model
        self.session = session

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @property
    def _headers(self) -> dict:
        return {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}

    @property
    def _url(self) -> str:
        return GEMINI_URL.format(model=self.model)

    def _payload(self, prompt: str, system: str, max_tokens: int) -> dict:
        config = {"temperature": 0.3, "maxOutputTokens": max_tokens}
        # У моделей 2.5 «размышления» съедают лимит токенов и ответ приходит
        # пустым — для быстрых ответов бота они не нужны.
        if "2.5" in self.model:
            config["thinkingConfig"] = {"thinkingBudget": 0}
        return {
            "system_instruction": {"parts": [{"text": system or AI_SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": config,
        }

    @staticmethod
    def _extract(data: dict) -> str:
        """Достаёт текст из ответа Gemini, разбирая типичные «пустые» случаи."""
        candidates = data.get("candidates") or []
        if not candidates:
            blocked = (data.get("promptFeedback") or {}).get("blockReason")
            return "" if not blocked else f"⚠️ Gemini отклонил запрос ({blocked})."
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text and candidates[0].get("finishReason") == "MAX_TOKENS":
            return "⚠️ Gemini не уложился в лимит токенов."
        return text

    async def ask(self, prompt: str, system: str = "") -> str:
        if not self.api_key:
            return "⚠️ Gemini отключён. Задайте GEMINI_API_KEY в переменных окружения."

        try:
            async with self.session.post(
                self._url,
                headers=self._headers,
                json=self._payload(prompt, system, 1500),
                timeout=aiohttp.ClientTimeout(total=AI_TIMEOUT),
            ) as resp:
                if resp.status == 200:
                    text = self._extract(await resp.json())
                    if text.startswith("⚠️"):
                        return text
                    return text[:AI_ANSWER_MAX_LEN] if text else "⚠️ Пустой ответ от Gemini."
                if resp.status == 429:
                    return "⚠️ Gemini: слишком много запросов. Подождите минуту."
                if resp.status in (401, 403):
                    return "⚠️ Неверный GEMINI_API_KEY."
                body = await resp.text()
                logger.error(f"Gemini статус {resp.status}: {body[:200]}")
                return "⚠️ Gemini временно недоступен. Попробуйте позже."
        except asyncio.TimeoutError:
            return "⚠️ Gemini не ответил вовремя."
        except Exception as e:
            logger.error(f"Gemini ошибка: {e}")
            return "⚠️ Ошибка подключения к Gemini."

    async def health_check(self) -> str:
        """Проверка доступности Gemini для /debug."""
        if not self.api_key:
            return "❌ Ключ не задан"
        try:
            async with self.session.post(
                self._url,
                headers=self._headers,
                json=self._payload("Скажи: ОК", "", 10),
                timeout=aiohttp.ClientTimeout(total=DEBUG_AI_TIMEOUT),
            ) as r:
                if r.status == 200:
                    return f"✅ {self.model} работает!"
                if r.status in (401, 403):
                    return "❌ Неверный ключ!"
                if r.status == 429:
                    return "⚠️ Rate limit"
                body = await r.text()
                return f"❌ Статус {r.status}: {body[:100]}"
        except asyncio.TimeoutError:
            return "⏱ Таймаут"
        except Exception as e:
            return f"💥 {str(e)[:60]}"
