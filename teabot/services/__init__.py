"""Клиенты внешних сервисов (Serper, Groq, Gemini) и маршрутизация мозгов."""
from .ai import GroqClient
from .gemini import GeminiClient
from .router import AIRouter, is_error_answer
from .search import SerperClient

__all__ = ["GroqClient", "GeminiClient", "AIRouter", "is_error_answer", "SerperClient"]
