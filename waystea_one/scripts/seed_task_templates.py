"""Seeds the daily checklist (docs/08_MVP_REQUIREMENTS.md §6,
docs/02_OPERATION_SYSTEM.md §6-7,13), applied to every store (store_id=None).

These are still placeholders reflecting the examples already in the docs —
the owner should review and adjust wording/criteria for what actually
matters at each store.

Tasks are revealed a `batch` at a time (owner decision: simplest first,
then batches of ~3-5) rather than all at once — see
app/services/tasks.py::advance_to_next_batch. Lower batch number = shown
sooner; order within a batch doesn't matter.

Upserts by title: existing rows get their fields updated (not just skipped)
so edits to this list take effect even though app/main.py runs this seeder
on every boot rather than once.

Most templates apply to every store (`store_name` omitted -> store_id NULL).
A few are specific to one store (e.g. the exhaust hood at Гагарина) — give
those a `store_name` matching a row in scripts/seed_stores.py and it's
resolved to that store's id at seed time.

Run standalone if needed:
    python -m scripts.seed_task_templates
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import ProofType, Store, TaskTemplate

TEMPLATES = [
    # Batch 1 — the simplest, quick presence/on-off checks. Lighting check
    # goes first per owner decision (before it used to be buried in batch 4).
    {
        "title": "Включить вывеску и освещение",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "batch": 1,
    },
    {
        "title": "Проверить освещение",
        "description": "Все лампы горят, ничего не перегорело и не мигает.",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "batch": 1,
    },
    {
        "title": "Включить музыку",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "batch": 1,
    },
    {
        "title": "Проверить, что музыка играет",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "batch": 1,
    },
    {
        "title": "Проверить наличие чая",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 1,
    },
    {
        "title": "Проверить наличие воды для чая",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 1,
    },
    # Batch 2 — consumables.
    {
        "title": "Проверить наличие молока, сиропов и сока",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 2,
    },
    {
        "title": "Проверить остаток одноразовой посуды",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 2,
    },
    {
        "title": "Проверить наличие упаковки для отпуска чая",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 2,
    },
    {
        "title": "Проверить наличие салфеток и бумажных полотенец",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 2,
    },
    # Batch 3 — cash/accounting.
    {
        "title": "Проверить кассу/POS",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 3,
    },
    {
        "title": "Проверить наличие мелких купюр и монет для сдачи",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 3,
    },
    {
        "title": "Проверить чековую ленту в кассе",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "batch": 3,
    },
    {
        "title": "Проверить, что банки с чаем подписаны и закрыты",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "description": (
            "На каждой банке — подпись/этикетка с названием чая, банка в "
            "аккуратном виде, крышка закрыта плотно, резинка на месте."
        ),
        "verification_criteria": (
            "На всех банках с чаем есть подписи/этикетки с названием, банки "
            "аккуратные, крышки плотно закрыты, резинки на месте."
        ),
        "batch": 3,
    },
    {
        "title": "Проверить наполнение банок с чаем",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "description": "Если в банке мало чая или она пустая — досыпать из запаса.",
        "batch": 3,
    },
    {
        "title": "Сверить чай в шкафах со списком на дверцах",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "description": (
            "Проверить, что чай в шкафах совпадает со списком на дверцах, и "
            "вписать в список актуальное количество каждого чая."
        ),
        "batch": 3,
    },
    # Batch 4 — equipment.
    {
        "title": "Проверить весы (чистота и калибровка)",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "verification_criteria": "Весы чистые, без остатков чая, пыли и разводов на платформе.",
        "batch": 4,
    },
    {
        "title": "Проверить чайник",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "description": "Чайник включается, температура выставляется, вода греется.",
        "batch": 4,
    },
    {
        "title": "Проверить вентиляцию/кондиционер",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "batch": 4,
    },
    {
        "title": "Проверить вытяжку",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "store_name": "Гагарина",
        "batch": 4,
    },
    {
        "title": "Подготовить оборудование",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "verification_criteria": (
            "Оборудование (чайники/кофемашина/техника) включено, чистое и "
            "готово к работе."
        ),
        "batch": 4,
    },
    # Batch 5 — deeper cleaning, takes longer.
    {
        "title": "Проверить рабочее место",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "description": (
            "Полы помыты, стойка протёрта от пыли, поверхности чистые, нет "
            "мусора, разводов, разлитой жидкости или посторонних предметов "
            "не по месту. Если грязно — помыть/протереть."
        ),
        "verification_criteria": (
            "Рабочее место чистое и убранное: полы помыты, стойка протёрта "
            "от пыли, поверхности чистые, нет мусора, разводов, разлитой "
            "жидкости или посторонних предметов не по месту."
        ),
        "batch": 5,
    },
    {
        "title": "Навести чистоту витрины и зала",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "description": (
            "Витрина протёрта, без пыли и разводов; товар аккуратно "
            "расставлен; в зале чисто и убрано, нет хаотично разбросанных "
            "вещей."
        ),
        "verification_criteria": (
            "Витрина протёрта, без пыли и разводов; товар аккуратно "
            "расставлен; в зале чисто и убрано, нет хаотично разбросанных "
            "вещей."
        ),
        "batch": 5,
    },
    {
        "title": "Протереть пыль на витрине и полках",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "verification_criteria": "На витрине и полках нет пыли, поверхности чистые.",
        "batch": 5,
    },
    {
        "title": "Проверить чистые чашки и чайники",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "verification_criteria": (
            "Чашки и чайники чистые: нет следов чая, потёков и подтёков, "
            "жирных пятен, сколов и трещин. Расставлены аккуратно, не "
            "навалены друг на друга."
        ),
        "batch": 5,
    },
    {
        "title": "Протереть чайную доску",
        "requires_proof": False,
        "proof_type": ProofType.NONE.value,
        "description": (
            "Протереть чайную доску (чабань) от разводов и воды, расставить "
            "все чайные принадлежности на свои места."
        ),
        "verification_criteria": (
            "Чайная доска (чабань) чистая: нет пятен, потёков воды или "
            "чайного налёта. Все нужные для церемонии предметы аккуратно "
            "разложены на своих местах, ничего лишнего не валяется."
        ),
        "batch": 5,
    },
    # Batch 6 — leftover.
    {
        "title": "Проверить посуду для продажи",
        "requires_proof": True,
        "proof_type": ProofType.COMMENT.value,
        "verification_criteria": (
            "Посуда, выставленная на продажу, чистая, целая, без сколов и "
            "трещин, аккуратно расставлена."
        ),
        "batch": 6,
    },
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        stores_by_name = {
            store.name: store.id
            for store in (await session.execute(select(Store))).scalars()
        }

        # (title, store_id) uniquely identifies a template — most are global
        # (store_id None), a few are store-specific (e.g. the Гагарина hood).
        current_keys = set()

        for raw in TEMPLATES:
            template_data = {k: v for k, v in raw.items() if k != "store_name"}
            store_id = stores_by_name.get(raw["store_name"]) if "store_name" in raw else None
            current_keys.add((template_data["title"], store_id))

            existing = await session.execute(
                select(TaskTemplate).where(
                    TaskTemplate.title == template_data["title"],
                    TaskTemplate.store_id == store_id
                    if store_id is not None
                    else TaskTemplate.store_id.is_(None),
                )
            )
            template = existing.scalar_one_or_none()
            if template is None:
                session.add(TaskTemplate(store_id=store_id, **template_data))
                continue
            for field, value in template_data.items():
                setattr(template, field, value)

        # Deactivate templates from an older version of this list (e.g. the
        # old "Проверить чистоту", superseded by the more specific checklist
        # items above) rather than leaving them active forever just because
        # this seeder only ever adds/updates.
        all_active = await session.execute(
            select(TaskTemplate).where(TaskTemplate.active.is_(True))
        )
        for template in all_active.scalars():
            if (template.title, template.store_id) not in current_keys:
                template.active = False

        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
