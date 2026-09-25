"""Пополнение библиотеки вопросов гостя: из зала и из интернета.

Библиотека из 18 сценариев кончается примерно за три недели смен. Дальше
вопросы должны приходить из реальности, а не из моей головы:

- из зала: продавец услышал вопрос, на котором растерялся, и отправил его
  боту командой /ask — это самое ценное сырьё, потому что это ровно те
  места, где ваши люди буксуют;
- из интернета: раз в неделю бот ищет живые формулировки покупателей и
  предлагает кандидатов.

Оба пути ведут не в библиотеку, а в очередь на одобрение владельцу. Из
зала приходит сырая формулировка, из интернета — чужой контекст и иногда
чушь; пускать это сотрудникам без человека нельзя.
"""
import logging

from sqlalchemy import select

from app.config import settings
from app.models import Employee, GuestScenario, PendingScenario

logger = logging.getLogger(__name__)

SOURCE_FLOOR = "зал"
SOURCE_INTERNET = "интернет"

STATUS_NEW = "новый"
STATUS_ADDED = "добавлен"
STATUS_REJECTED = "отклонён"

# Сколько кандидатов из интернета предлагать за один заход. Больше — и
# одобрение превращается в разгребание очереди, которое владелец бросит.
INTERNET_BATCH = 3


async def submit_from_floor(session, employee: Employee, question: str) -> PendingScenario:
    """Вопрос, записанный продавцом в зале."""
    from app.services.ai import draft_answer_points
    from app.services.knowledge import get_knowledge_base_text

    knowledge = await get_knowledge_base_text(session)
    draft = await draft_answer_points(question, knowledge)

    candidate = PendingScenario(
        question=question.strip()[:500],
        draft_points=draft[:1000],
        source=SOURCE_FLOOR,
        submitted_by_id=employee.id,
    )
    session.add(candidate)
    await session.commit()
    await session.refresh(candidate)
    return candidate


async def approve(session, candidate_id: int) -> GuestScenario | None:
    """Переносит кандидата в библиотеку. Повторный дубль вопроса не создаёт."""
    candidate = await session.get(PendingScenario, candidate_id)
    if candidate is None or candidate.status != STATUS_NEW:
        return None

    existing = await session.scalar(
        select(GuestScenario).where(GuestScenario.question == candidate.question)
    )
    if existing is None:
        existing = GuestScenario(
            question=candidate.question, good_answer_points=candidate.draft_points
        )
        session.add(existing)
    candidate.status = STATUS_ADDED
    await session.commit()
    return existing


async def reject(session, candidate_id: int) -> bool:
    candidate = await session.get(PendingScenario, candidate_id)
    if candidate is None or candidate.status != STATUS_NEW:
        return False
    candidate.status = STATUS_REJECTED
    await session.commit()
    return True


async def collect_from_internet(session) -> list[PendingScenario]:
    """Ищет живые формулировки покупателей и складывает кандидатов в очередь.

    Дубли отсеиваются по точному совпадению вопроса — и с библиотекой, и с
    уже висящей очередью, чтобы владельцу не приходило одно и то же.
    """
    from app.services.ai import extract_guest_questions, draft_answer_points
    from app.services.knowledge import get_knowledge_base_text
    from app.services.websearch import find_question_snippets

    snippets = await find_question_snippets()
    if not snippets:
        return []

    questions = await extract_guest_questions(snippets, INTERNET_BATCH)
    if not questions:
        return []

    known = set(
        (await session.execute(select(GuestScenario.question))).scalars()
    ) | set(
        (
            await session.execute(
                select(PendingScenario.question).where(PendingScenario.status == STATUS_NEW)
            )
        ).scalars()
    )

    knowledge = await get_knowledge_base_text(session)
    created: list[PendingScenario] = []
    for question in questions:
        question = question.strip()[:500]
        if not question or question in known:
            continue
        candidate = PendingScenario(
            question=question,
            draft_points=(await draft_answer_points(question, knowledge))[:1000],
            source=SOURCE_INTERNET,
        )
        session.add(candidate)
        created.append(candidate)
        known.add(question)

    await session.commit()
    for candidate in created:
        await session.refresh(candidate)
    return created


async def notify_owner(bot, candidate: PendingScenario, author_name: str | None = None) -> None:
    from app.handlers.scenarios import approval_keyboard

    origin = f"от {author_name} (зал)" if author_name else "из интернета"
    text = (
        f"🎭 <b>Новый вопрос гостя {origin}</b>\n\n"
        f"«{candidate.question}»\n\n"
        f"<i>Черновик разбора:</i>\n{candidate.draft_points or '—'}"
    )
    try:
        await bot.send_message(
            settings.owner_telegram_id, text, reply_markup=approval_keyboard(candidate.id)
        )
    except Exception:
        logger.exception("Не удалось показать владельцу кандидата %s", candidate.id)


async def propose_internet_questions(bot, session_factory) -> None:
    """Раз в неделю. Молчит, когда предлагать нечего — пустое сообщение
    владельцу хуже, чем его отсутствие."""
    async with session_factory() as session:
        candidates = await collect_from_internet(session)
        for candidate in candidates:
            await notify_owner(bot, candidate)
