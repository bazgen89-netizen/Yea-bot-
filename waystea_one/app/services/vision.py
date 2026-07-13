"""Photo verification for tasks with a `verification_criteria` — e.g. "Рабочее
место чистое, без мусора". Part of the AI Processing Layer
(docs/04_TECH_SPEC.md §3.1): the only other place calling an LLM is
app/services/ai.py (text Q&A); this is the vision counterpart.

Degrades the same way as ai.py: no ANTHROPIC_API_KEY, or the call failing,
means "accept the photo as before" rather than blocking the employee on an
AI outage — see docs/03_AI_BRAIN.md §13 (don't invent, don't get in the way).
"""
import base64
import logging
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты проверяешь фото, присланное сотрудником чайного магазина как "
    "подтверждение выполненной задачи. Тебе дан критерий, которому должно "
    "соответствовать фото. Оцени строго по этому критерию, без выдумывания "
    "деталей, которых не видно на фото. Ответь ровно в этом формате, ничего "
    "лишнего:\n"
    "РЕЗУЛЬТАТ: да\n"
    "или\n"
    "РЕЗУЛЬТАТ: нет\n"
    "КОММЕНТАРИЙ: <короткое, дружелюбное объяснение, если результат «нет» — "
    "что именно не так и что поправить>"
)


@dataclass(frozen=True)
class VerificationResult:
    passed: bool
    comment: str


async def verify_photo(image_bytes: bytes, criteria: str) -> VerificationResult:
    if not settings.anthropic_api_key:
        return VerificationResult(passed=True, comment="")

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=300,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64.b64encode(image_bytes).decode(),
                            },
                        },
                        {"type": "text", "text": f"Критерий: {criteria}"},
                    ],
                }
            ],
        )
        text = response.content[0].text
        return _parse_result(text)
    except Exception:
        logger.exception("Photo verification call failed")
        return VerificationResult(passed=True, comment="")


def _parse_result(text: str) -> VerificationResult:
    lowered = text.lower()
    passed = "результат: да" in lowered
    comment = ""
    idx = lowered.find("комментарий:")
    if idx != -1:
        comment = text[idx + len("комментарий:") :].strip()
    return VerificationResult(passed=passed, comment=comment)
