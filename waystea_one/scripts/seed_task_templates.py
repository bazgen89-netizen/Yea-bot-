"""Seeds the daily checklist (docs/08_MVP_REQUIREMENTS.md §6,
docs/02_OPERATION_SYSTEM.md §6-7,13), applied to every store (store_id=None).

These are still placeholders reflecting the examples already in the docs —
the owner should review and adjust wording/criteria for what actually
matters at each store.

Upserts by title: existing rows get their fields updated (not just skipped)
so edits to this list take effect even though app/main.py runs this seeder
on every boot rather than once.

Run standalone if needed:
    python -m scripts.seed_task_templates
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import ProofType, TaskTemplate

TEMPLATES = [
    {
        "title": "Проверить рабочее место",
        "requires_proof": True,
        "proof_type": ProofType.PHOTO.value,
        "verification_criteria": (
            "Рабочее место чистое и убранное: поверхности протёрты, нет "
            "мусора, пыли, разводов, разлитой жидкости или посторонних "
            "предметов не по месту."
        ),
    },
    {
        "title": "Проверить наличие чая",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
    },
    {
        "title": "Подготовить оборудование",
        "requires_proof": True,
        "proof_type": ProofType.PHOTO.value,
        "verification_criteria": (
            "Оборудование (чайники/кофемашина/техника) включено, чистое и "
            "готово к работе."
        ),
    },
    {
        "title": "Проверить чистоту витрины и зала",
        "requires_proof": True,
        "proof_type": ProofType.PHOTO.value,
        "verification_criteria": (
            "Витрина протёрта, без пыли и разводов; товар аккуратно "
            "расставлен; в зале чисто и убрано, нет хаотично разбросанных "
            "вещей."
        ),
    },
    {
        "title": "Проверить чистые чашки и чайники",
        "requires_proof": True,
        "proof_type": ProofType.PHOTO.value,
        "verification_criteria": (
            "Чашки и чайники чистые: нет следов чая, разводов, потёков, "
            "жирных пятен, сколов и трещин. Расставлены аккуратно, не "
            "навалены друг на друга."
        ),
    },
    {
        "title": "Проверить чайную доску",
        "requires_proof": True,
        "proof_type": ProofType.PHOTO.value,
        "verification_criteria": (
            "Чайная доска (чабань) чистая: нет пятен, потёков воды или "
            "чайного налёта. Все нужные для церемонии предметы аккуратно "
            "разложены на своих местах, ничего лишнего не валяется."
        ),
    },
    {
        "title": "Проверить кассу/POS",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
    },
    {
        "title": "Включить вывеску и освещение",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
    },
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        current_titles = {t["title"] for t in TEMPLATES}

        for template_data in TEMPLATES:
            existing = await session.execute(
                select(TaskTemplate).where(
                    TaskTemplate.title == template_data["title"],
                    TaskTemplate.store_id.is_(None),
                )
            )
            template = existing.scalar_one_or_none()
            if template is None:
                session.add(TaskTemplate(store_id=None, **template_data))
                continue
            for field, value in template_data.items():
                setattr(template, field, value)

        # Deactivate global templates from an older version of this list
        # (e.g. the old "Проверить чистоту", superseded by the more
        # specific checklist items above) rather than leaving them active
        # forever just because this seeder only ever adds/updates.
        stale = await session.execute(
            select(TaskTemplate).where(
                TaskTemplate.store_id.is_(None),
                TaskTemplate.title.not_in(current_titles),
                TaskTemplate.active.is_(True),
            )
        )
        for template in stale.scalars():
            template.active = False

        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
