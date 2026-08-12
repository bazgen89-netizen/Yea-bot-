"""AI Processing Layer (docs/04_TECH_SPEC.md §3.1) — the one place that
talks to the LLM. For MVP this only answers employee questions from the
company knowledge base (docs/03_AI_BRAIN.md §7); shift/task/purchasing/
revenue/upsell detection stay keyword-based on purpose (see their modules'
docstrings) since those are simple enough not to need it.
"""
import logging

from app.config import settings

logger = logging.getLogger(__name__)


def _extract_text(response) -> str:
    """`response.content[0]` isn't reliably the text block — with extended
    thinking the model can put a `ThinkingBlock` (no `.text` attribute)
    first, which crashed every call with an AttributeError. Find the first
    actual text block instead of assuming position.
    """
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


SYSTEM_PROMPT = (
    "Ты — WAYSTEA ONE, AI-менеджер и чайный эксперт магазинов WAYSTEA. "
    "Общайся с сотрудниками дружелюбно, уважительно, профессионально, "
    "живо и по-человечески, как опытный чайный мастер и наставник, а не "
    "как зачитывающий инструкцию бот.\n\n"
    "Ты — настоящий эксперт по китайскому чаю и опираешься на китайскую "
    "чайную традицию: сорта и их обработка (зелёный, белый, жёлтый, улуны, "
    "красный/хун ча, пуэр шэн и шу, тёмные чаи хэй ча), терруар и известные "
    "горы (Уишань, Фэнхуан, Иу, Мэнхай и др.), способы заваривания "
    "(гунфу-ча, проливы, температура воды, посуда — гайвань, исин), "
    "вкусоароматические профили, выдержка, хранение, чайные церемонии и "
    "история. На такие вопросы отвечай уверенно и по существу, как эксперт "
    "— здесь база знаний не нужна, используй свои знания.\n\n"
    "НО: конкретные факты именно про WAYSTEA — ассортимент магазина, цены, "
    "что сейчас в наличии, внутренние стандарты и инструкции — бери СТРОГО "
    "из базы знаний компании ниже и никогда не выдумывай их. Если такого "
    "факта в базе знаний нет — честно скажи, что уточнишь у владельца, и не "
    "придумывай цену/наличие. Общее про чай можно рассказывать всегда; "
    "выдумывать нельзя только специфику WAYSTEA."
)

FALLBACK_NO_KEY = (
    "Пока не могу ответить (не настроен ИИ-модуль). "
    "Уточню у владельца и отвечу позже."
)
FALLBACK_ERROR = (
    "Не получилось найти ответ прямо сейчас. Уточню у владельца и вернусь с ответом."
)
# The model appends this on its own line when the question is a
# WAYSTEA-specific fact it couldn't answer from the knowledge base — the
# caller (app/handlers/shift.py) strips it from the employee reply and
# forwards the question to the owner. General tea questions never carry it.
ASK_OWNER_MARKER = "[УТОЧНИТЬ_У_ВЛАДЕЛЬЦА]"

_ASK_OWNER_INSTRUCTION = (
    "\n\nЕсли вопрос про специфику WAYSTEA (ассортимент, цена, наличие, "
    "внутренние правила) и в базе знаний ответа нет — в самом конце ответа "
    f"на отдельной строке добавь ровно: {ASK_OWNER_MARKER}"
)


async def answer_employee_question(
    question: str, knowledge_base: str, include_debug: bool = False
) -> str:
    if not settings.anthropic_api_key:
        return FALLBACK_NO_KEY

    kb = knowledge_base.strip() or "(база знаний пока пустая)"
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=600,
            system=f"{SYSTEM_PROMPT}{_ASK_OWNER_INSTRUCTION}\n\nБаза знаний WAYSTEA:\n{kb}",
            messages=[{"role": "user", "content": question}],
        )
        return _extract_text(response) or FALLBACK_ERROR
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
        return _extract_text(response) or CHAT_FALLBACK
    except Exception:
        logger.exception("AI chat reply failed")
        return CHAT_FALLBACK
