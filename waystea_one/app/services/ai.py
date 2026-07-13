"""AI Processing Layer (docs/04_TECH_SPEC.md §3.1) — the one place that
talks to the LLM. For MVP this only answers employee questions from the
company knowledge base (docs/03_AI_BRAIN.md §7); shift/task/purchasing/
revenue/upsell detection stay keyword-based on purpose (see their modules'
docstrings) since those are simple enough not to need it.
"""
import logging

from app.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты — WAYSTEA ONE, AI-менеджер операций чайных магазинов WAYSTEA. "
    "Общайся с сотрудниками дружелюбно, уважительно, профессионально, "
    "как опытный менеджер, а не как надзиратель. "
    "Отвечай ТОЛЬКО на основании базы знаний компании, приведённой ниже. "
    "Если в базе знаний нет ответа — прямо скажи, что пока не знаешь, "
    "и что уточнишь у владельца. Никогда не выдумывай факты."
)

FALLBACK_NO_KEY = (
    "Пока не могу обратиться к базе знаний (не настроен ИИ-модуль). "
    "Уточню у владельца и отвечу позже."
)
FALLBACK_ERROR = (
    "Не получилось найти ответ прямо сейчас. Уточню у владельца и вернусь с ответом."
)
FALLBACK_EMPTY_KB = (
    "У меня пока нет базы знаний по этому вопросу. Уточню у владельца и вернусь с ответом."
)


async def answer_employee_question(question: str, knowledge_base: str) -> str:
    if not knowledge_base.strip():
        return FALLBACK_EMPTY_KB

    if not settings.anthropic_api_key:
        return FALLBACK_NO_KEY

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=500,
            system=f"{SYSTEM_PROMPT}\n\nБаза знаний:\n{knowledge_base}",
            messages=[{"role": "user", "content": question}],
        )
        return response.content[0].text
    except Exception:
        logger.exception("AI Processing Layer call failed")
        return FALLBACK_ERROR
