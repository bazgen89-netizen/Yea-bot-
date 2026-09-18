"""Seeds the three known stores (docs/07_BUSINESS_CONTEXT.md §3).

Run once after the database is up:
    python -m scripts.seed_stores
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import Store

# Coordinates are taken from the stores' Yandex Maps organisation cards, so
# they point at the map card's centre rather than the actual doorway — hence
# the deliberately loose 300 m radius. Calibrate on site with /where and
# tighten to ~150 m afterwards (README "Геометка").
STORES = [
    {
        "name": "Черёмушки",
        "aliases": ["черемушки", "черёмушк", "че"],
        "lat": 56.138837,
        "lon": 40.365208,
        "radius_m": 300,
    },
    {
        "name": "Гагарина",
        "aliases": ["гагарин", "гага"],
        "lat": 56.129401,
        "lon": 40.403756,
        "radius_m": 300,
    },
    {
        "name": "Рынок на Студёной",
        "aliases": ["студен", "рынок", "рынок на студеной", "маркет", "market"],
        "lat": 56.126273,
        "lon": 40.388906,
        "radius_m": 300,
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
            # Update aliases and coordinates on an already-seeded store too — this seeder
            # runs on every boot, so a newly added alias (e.g. "маркет" for
            # Рынок на Студёной) must actually take effect on the live DB,
            # not be skipped just because the store row already exists.
            store.aliases = store_data["aliases"]
            # Coordinates get re-seeded too: calibration changes them, and a
            # store row already exists on the live DB from the first boot.
            store.lat = store_data["lat"]
            store.lon = store_data["lon"]
            store.radius_m = store_data["radius_m"]
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
