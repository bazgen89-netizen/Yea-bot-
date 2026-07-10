"""Клиенты внешних сервисов (Serper, Groq)."""
from .ai import GroqClient
from .search import SerperClient

__all__ = ["GroqClient", "SerperClient"]
