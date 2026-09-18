"""Seeds the tea knowledge check (app/services/quiz.py).

These are PLACEHOLDERS built from the rotation list the owner already uses
(WAYSTEA_Chai_Rotation_Reference), so the feature works from day one. They
must be replaced with the real technological cards — once those arrive,
edit QUESTIONS here and redeploy; re-seeding updates existing rows in place.

Run once after the database is up (app/main.py also runs it on every boot):
    python -m scripts.seed_quiz
"""
import asyncio

from sqlalchemy import select

from app.db import get_session, init_models
from app.models import QuizQuestion

QUESTIONS = [
    {
        "card": "Шэн пуэр молодой",
        "question": "Какой водой заваривать молодой шэн?",
        "options": ["70-75 °C", "85-90 °C", "Крутым кипятком"],
        "answer_index": 1,
        "explain": "Кипяток выжигает молодой шэн — уходит в горечь.",
    },
    {
        "card": "Шэн пуэр молодой",
        "question": "Гость говорит «горчит». Что делаем первым?",
        "options": [
            "Говорим, что так и должно быть",
            "Снижаем температуру и сокращаем пролив до 5-7 секунд",
            "Предлагаем другой чай",
        ],
        "answer_index": 1,
        "explain": "Сначала правим заварку, а не уводим гостя с чая.",
    },
    {
        "card": "Шу Пуэр Хайваньский 9978",
        "question": "Зачем шу пуэр промывают перед завариванием?",
        "options": [
            "Чтобы смыть пыль и раскрыть спрессованный лист",
            "Чтобы убрать горечь",
            "Промывать не нужно",
        ],
        "answer_index": 0,
        "explain": "Быстрый пролив 3-5 секунд: лист «просыпается», настой становится чище.",
    },
    {
        "card": "Те Гуань Инь",
        "question": "Сколько проливов держит качественный Те Гуань Инь?",
        "options": ["2-3", "5-7", "10 и больше"],
        "answer_index": 2,
        "explain": "Свёрнутый лист раскрывается постепенно — это и есть признак качества.",
    },
    {
        "card": "Да Хун Пао",
        "question": "Чем пахнет правильно прожаренный Да Хун Пао?",
        "options": [
            "Свежей травой",
            "Печёными фруктами, карамелью, лёгким дымком",
            "Рыбой и землёй",
        ],
        "answer_index": 1,
        "explain": "Землистый запах у улуна — признак сырости при хранении, а не нормы.",
    },
    {
        "card": "Дянь Хун Мао Фэн",
        "question": "Кому уверенно предлагать Дянь Хун новичку?",
        "options": [
            "Тому, кто пьёт кофе и любит плотный вкус",
            "Тому, кто просит что-то лёгкое и травяное",
            "Только опытным ценителям",
        ],
        "answer_index": 0,
        "explain": "Красный чай с медово-солодовым вкусом — понятный мост с кофе.",
    },
]


async def seed() -> None:
    await init_models()
    async with get_session() as session:
        for data in QUESTIONS:
            existing = await session.execute(
                select(QuizQuestion).where(
                    QuizQuestion.card == data["card"],
                    QuizQuestion.question == data["question"],
                )
            )
            question = existing.scalar_one_or_none()
            if question is None:
                session.add(QuizQuestion(**data))
                continue
            # Re-seed in place: this runs on every boot, so an edited answer
            # or wording must actually reach the live database.
            question.options = data["options"]
            question.answer_index = data["answer_index"]
            question.explain = data["explain"]
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
