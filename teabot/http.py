"""Общая aiohttp-сессия приложения.

Одна ClientSession на всё приложение (переиспользование TCP-соединений)
вместо создания новой сессии на каждый запрос. Создаётся на старте
веб-приложения, закрывается при остановке.
"""
import aiohttp


def create_session() -> aiohttp.ClientSession:
    return aiohttp.ClientSession()


async def close_session(session: aiohttp.ClientSession) -> None:
    if not session.closed:
        await session.close()
