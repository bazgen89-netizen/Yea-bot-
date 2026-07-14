from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KnowledgeEntry


async def get_knowledge_base_text(session: AsyncSession) -> str:
    result = await session.execute(select(KnowledgeEntry))
    entries = result.scalars().all()
    return "\n\n".join(f"### {entry.title}\n{entry.content}" for entry in entries)


async def create_knowledge_entry(
    session: AsyncSession, title: str, content: str
) -> KnowledgeEntry:
    """Owner-facing addition via /addknowledge (app/handlers/owner.py) —
    lets the owner grow Company Memory (docs/03_AI_BRAIN.md §6.5) directly
    from Telegram instead of needing a code change every time.
    """
    entry = KnowledgeEntry(title=title[:200], content=content[:2000])
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry
