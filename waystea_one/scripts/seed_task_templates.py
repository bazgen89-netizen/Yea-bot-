"""Seeds the default daily checklist (docs/08_MVP_REQUIREMENTS.md §6),
applied to every store (store_id=None).

Run once after the database is up:
    python -m scripts.seed_task_templates
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import ProofType, TaskTemplate

TEMPLATES = [
    {"title": "Проверить рабочее место", "requires_proof": False},
    {"title": "Проверить наличие чая", "requires_proof": False},
    {
        "title": "Подготовить оборудование",
        "requires_proof": True,
        "proof_type": ProofType.PHOTO.value,
    },
    {"title": "Проверить чистоту", "requires_proof": False},
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        for template_data in TEMPLATES:
            existing = await session.execute(
                select(TaskTemplate).where(
                    TaskTemplate.title == template_data["title"],
                    TaskTemplate.store_id.is_(None),
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue
            session.add(TaskTemplate(store_id=None, **template_data))
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
