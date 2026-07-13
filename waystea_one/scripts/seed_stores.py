"""Seeds the three known stores (docs/07_BUSINESS_CONTEXT.md §3).

Run once after the database is up:
    python -m scripts.seed_stores
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import Store

STORES = [
    {"name": "Черёмушки", "aliases": ["черемушки", "черёмушк"]},
    {"name": "Гагарина", "aliases": ["гагарин"]},
    {
        "name": "Рынок на Студёной",
        "aliases": ["студен", "рынок"],
    },
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        for store_data in STORES:
            existing = await session.execute(
                select(Store).where(Store.name == store_data["name"])
            )
            if existing.scalar_one_or_none() is not None:
                continue
            session.add(Store(**store_data))
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
