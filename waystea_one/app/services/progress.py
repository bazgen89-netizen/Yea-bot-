"""Личный прогресс сотрудника: ранг, серия, статистика за неделю.

Соревнования между людьми здесь намеренно нет. На троих сотрудников
публичный рейтинг быстро превращается в «кто хуже» и demотивирует того, кто
внизу; личный прогресс и серия работают на всех сразу.
"""
import datetime

from sqlalchemy import distinct, func, select

from app.models import GuestAnswer, QuizAnswer, QuizQuestion, QuizReview, ShiftLog

# Порог — число карт, по которым сотрудник хоть раз ответил верно
RANKS = (
    (0, "🌱 Новичок"),
    (3, "🍃 Ученик"),
    (7, "🫖 Знаток"),
    (12, "🏅 Мастер"),
    (20, "🐉 Чайный дракон"),
)


def rank_for(cards_learned: int) -> str:
    title = RANKS[0][1]
    for threshold, name in RANKS:
        if cards_learned >= threshold:
            title = name
    return title


def next_rank(cards_learned: int) -> tuple[str, int] | None:
    """Следующий ранг и сколько карт до него — прогресс виден, пока он есть."""
    for threshold, name in RANKS:
        if cards_learned < threshold:
            return name, threshold - cards_learned
    return None


async def cards_learned(session, employee_id: int) -> int:
    return int(
        await session.scalar(
            select(func.count(distinct(QuizQuestion.card)))
            .select_from(QuizAnswer)
            .join(QuizQuestion, QuizAnswer.question_id == QuizQuestion.id)
            .where(QuizAnswer.employee_id == employee_id, QuizAnswer.correct.is_(True))
        )
        or 0
    )


async def tasting_streak(session, employee_id: int, today: datetime.date | None = None) -> int:
    """Сколько смен подряд заканчивались записью впечатления о чае.

    Считается по сменам, а не по календарным дням: выходной не должен
    обнулять серию — иначе она наказывает за график, а не за небрежность.
    """
    today = today or datetime.date.today()
    shifts = list(
        (
            await session.execute(
                select(ShiftLog)
                .where(ShiftLog.employee_id == employee_id, ShiftLog.date <= today)
                .order_by(ShiftLog.date.desc())
            )
        ).scalars()
    )
    streak = 0
    for shift in shifts:
        if not shift.brewed_tea_feedback:
            break
        streak += 1
    return streak


async def weekly_stats(session, employee_id: int, today: datetime.date | None = None) -> dict:
    today = today or datetime.date.today()
    week_ago = today - datetime.timedelta(days=7)

    answers = list(
        (
            await session.execute(
                select(QuizAnswer).where(
                    QuizAnswer.employee_id == employee_id, QuizAnswer.date > week_ago
                )
            )
        ).scalars()
    )
    guest_answers = int(
        await session.scalar(
            select(func.count(GuestAnswer.id)).where(
                GuestAnswer.employee_id == employee_id, GuestAnswer.date > week_ago
            )
        )
        or 0
    )
    pending_reviews = int(
        await session.scalar(
            select(func.count(QuizReview.id)).where(
                QuizReview.employee_id == employee_id, QuizReview.completed.is_(False)
            )
        )
        or 0
    )
    learned = await cards_learned(session, employee_id)

    return {
        "cards_learned": learned,
        "rank": rank_for(learned),
        "next_rank": next_rank(learned),
        "streak": await tasting_streak(session, employee_id, today),
        "quiz_total": len(answers),
        "quiz_correct": sum(1 for a in answers if a.correct),
        "guest_answers": guest_answers,
        "pending_reviews": pending_reviews,
    }


def format_stats(name: str, stats: dict) -> str:
    lines = [f"<b>{name}</b> — {stats['rank']}", ""]
    lines.append(f"🫖 Изучено карт: {stats['cards_learned']}")

    upcoming = stats["next_rank"]
    if upcoming:
        title, left = upcoming
        lines.append(f"   до ранга «{title}» осталось карт: {left}")

    if stats["streak"]:
        lines.append(f"🔥 Смен подряд с дегустацией: {stats['streak']}")
    else:
        lines.append("🔥 Серия прервана — запиши сегодня впечатление о чае (/feedback)")

    lines.append("")
    lines.append("<i>За неделю</i>")
    if stats["quiz_total"]:
        lines.append(f"🧠 Вопросы: {stats['quiz_correct']} из {stats['quiz_total']}")
    else:
        lines.append("🧠 Вопросов пока не было")
    lines.append(f"🎭 Ответов гостю: {stats['guest_answers']}")

    if stats["pending_reviews"]:
        lines.append(f"📌 На повторении: {stats['pending_reviews']} вопрос(ов) — вернутся сами")
    return "\n".join(lines)
