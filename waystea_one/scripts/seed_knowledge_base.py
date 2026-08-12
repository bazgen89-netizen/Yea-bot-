"""Seeds a couple of starter Company Memory entries (docs/03_AI_BRAIN.md
§6.5) so the Q&A feature has something to answer from. The owner should
replace/expand these with real WAYSTEA instructions — these are placeholders
based on the examples already in docs/02_OPERATION_SYSTEM.md §14 and
docs/03_AI_BRAIN.md §12.

Run once after the database is up:
    python -m scripts.seed_knowledge_base
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import KnowledgeEntry

ENTRIES = [
    {
        "title": "Работа с недовольным клиентом",
        "content": (
            "Выслушать спокойно, не спорить. Извиниться за неудобство. "
            "Предложить решение (замена напитка, дегустация другого чая). "
            "Если клиент требует возврат денег или ситуация выходит за рамки — "
            "сообщить владельцу, самостоятельно возврат не оформлять."
        ),
    },
    {
        "title": "Da Hong Pao — заваривание",
        "content": (
            "Используйте гайвань или маленький чайник. Температура воды 95-100°C. "
            "Первая заварка — слив (ополаскивание листа), не пить. "
            "Далее заваривать 10-15 секунд, увеличивая время на 5 секунд с каждой следующей заваркой. "
            "Da Hong Pao можно заваривать 6-8 раз."
        ),
    },
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        for entry_data in ENTRIES:
            existing = await session.execute(
                select(KnowledgeEntry).where(KnowledgeEntry.title == entry_data["title"])
            )
            if existing.scalar_one_or_none() is not None:
                continue
            session.add(KnowledgeEntry(**entry_data))
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
