"""Клиенты внешних сервисов (Serper, Groq) и менеджер VPN-ключей."""
from . import qr
from .ai import GroqClient
from .search import SerperClient
from .vpn import VpnManager, VpnServer

__all__ = ["GroqClient", "SerperClient", "VpnManager", "VpnServer", "qr"]
