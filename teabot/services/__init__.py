"""Клиенты внешних сервисов (Serper, AI)."""
from .ai import AIClient, GroqClient
from .search import SerperClient

__all__ = ["AIClient", "GroqClient", "SerperClient"]
