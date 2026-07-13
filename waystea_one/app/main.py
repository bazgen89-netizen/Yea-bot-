import asyncio
import logging

from app.bot import bot, dispatcher
from app.db import init_models

logging.basicConfig(level=logging.INFO)


async def main() -> None:
    await init_models()
    await bot.delete_webhook(drop_pending_updates=True)
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
