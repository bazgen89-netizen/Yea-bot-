from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KnowledgeEntry


async def get_knowledge_base_text(session: AsyncSession) -> str:
    result = await session.execute(select(KnowledgeEntry))
    entries = result.scalars().all()
    return "\n\n".join(f"### {entry.title}\n{entry.content}" for entry in entries)
