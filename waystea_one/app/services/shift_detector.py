"""Detects whether a message looks like a shift-start ("на месте") message.

Kept intentionally simple (keyword match) for MVP reliability, per
docs/05_CLAUDE_INSTRUCTIONS.md §14 ("avoid unnecessary complexity"). If this
proves too narrow once real messages come in, the AI Processing Layer
(docs/04_TECH_SPEC.md §3.1) is the place to add LLM-based intent
classification instead of growing this keyword list indefinitely.
"""
from app.services.store_matcher import normalize

SHIFT_START_PHRASES = [
    "на месте",
    "я пришел",
    "я пришёл",
    "на смене",
    "я на смене",
]


def is_shift_start_message(text: str) -> bool:
    normalized = normalize(text)
    return any(phrase in normalized for phrase in SHIFT_START_PHRASES)
