"""Seeds the three known stores (docs/07_BUSINESS_CONTEXT.md §3).

Run once after the database is up:
    python -m scripts.seed_stores
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import Store

STORES = [
    {"name": "Черёмушки", "aliases": ["черемушки", "черёмушк", "че"]},
    {"name": "Гагарина", "aliases": ["гагарин", "гага"]},
    {
        "name": "Рынок на Студёной",
        "aliases": ["студен", "рынок", "рынок на студеной", "маркет", "market"],
    },
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        for store_data in STORES:
            existing = await session.execute(
                select(Store).where(Store.name == store_data["name"])
            )
            store = existing.scalar_one_or_none()
            if store is None:
                session.add(Store(**store_data))
                continue
            # Update aliases on an already-seeded store too — this seeder
            # runs on every boot, so a newly added alias (e.g. "маркет" for
            # Рынок на Студёной) must actually take effect on the live DB,
            # not be skipped just because the store row already exists.
            store.aliases = store_data["aliases"]
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
