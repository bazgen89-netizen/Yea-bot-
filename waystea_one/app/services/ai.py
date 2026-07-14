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
    "живо и по-человечески, как толковый опытный менеджер, а не как "
    "зачитывающий инструкцию бот. "
    "На общие вопросы, вопросы о себе/своих возможностях, small talk — "
    "отвечай свободно и по-своему, база знаний тут не нужна. "
    "Но если вопрос касается конкретных фактов о магазине, товаре, "
    "инструкций для сотрудников — отвечай СТРОГО на основании базы "
    "знаний компании, приведённой ниже, и никогда не выдумывай такие "
    "факты. Если по такому вопросу в базе знаний ответа нет — прямо "
    "скажи, что пока не знаешь, и что уточнишь у владельца."
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


async def answer_employee_question(
    question: str, knowledge_base: str, include_debug: bool = False
) -> str:
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
    except Exception as error:
        logger.exception("AI Processing Layer call failed")
        # The owner has no access to Render's logs, so when it's the owner
        # asking, surface the exception type/message instead of a fully
        # generic line — otherwise diagnosing an AI outage needs a code
        # change every time just to see what actually failed.
        if include_debug:
            return f"{FALLBACK_ERROR}\n(отладка: {type(error).__name__}: {error})"
        return FALLBACK_ERROR


CHAT_SYSTEM_PROMPT = (
    "Ты — WAYSTEA ONE, AI-менеджер операций чайных магазинов WAYSTEA. "
    "Сотрудник только что ответил на вопрос о своём настроении/делах в "
    "начале смены. Коротко (1-2 предложения), тепло и по-человечески "
    "отреагируй на его ответ — как хороший менеджер, который правда "
    "интересуется, а не для галочки. Не задавай новых вопросов и не "
    "переходи к рабочим задачам — просто поддержи разговор одной репликой."
)

CHAT_FALLBACK = "Здорово! 😊 Ну что, тогда приступим потихоньку."


async def chat_reply(employee_message: str) -> str:
    """One short, warm acknowledgement of the employee's mood/small-talk
    reply — used once, right after the morning greeting and before task
    assignment. Not knowledge-base bound like answer_employee_question;
    this is just conversational, so an unconfigured/erroring AI layer
    falls back to a generic friendly line rather than going silent.
    """
    if not settings.anthropic_api_key:
        return CHAT_FALLBACK

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=150,
            system=CHAT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": employee_message}],
        )
        return response.content[0].text
    except Exception:
        logger.exception("AI chat reply failed")
        return CHAT_FALLBACK
