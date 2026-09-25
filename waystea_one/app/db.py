from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Base


def normalize_database_url(url: str) -> str:
    """Accept a connection string in whatever form the hosting panel gives it.

    Render, Neon and Supabase all hand out a libpq-style URL meant for psql
    (`postgres://...?sslmode=require`), while this app talks to Postgres
    through asyncpg, which needs `postgresql+asyncpg://` and rejects
    libpq-only query parameters outright. Editing that by hand in a web
    form is exactly the step that gets mistyped at 2am, so the app fixes it
    instead of asking anyone to.
    """
    if not url:
        return url

    for legacy, driver in (("postgres://", "postgresql+asyncpg://"),
                           ("postgresql://", "postgresql+asyncpg://")):
        if url.startswith(legacy):
            url = driver + url[len(legacy):]
            break

    parts = urlsplit(url)
    params = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key == "sslmode":
            # asyncpg spells it `ssl` and knows nothing about libpq's
            # disable/allow/prefer gradations — anything that asked for TLS
            # becomes a plain requirement, anything that refused it is dropped.
            if value in ("require", "verify-ca", "verify-full", "prefer", "allow"):
                params.append(("ssl", "require"))
            continue
        if key in ("channel_binding", "target_session_attrs", "options"):
            continue  # libpq-only, asyncpg raises on them
        params.append((key, value))

    return urlunsplit(parts._replace(query=urlencode(params)))


engine = create_async_engine(normalize_database_url(settings.database_url))
async_session = async_sessionmaker(engine, expire_on_commit=False)

# Base.metadata.create_all only creates tables that don't exist yet — it does
# NOT add new columns to tables that already exist on a live database (e.g.
# Render's Postgres, which already had task_templates/tasks before
# verification_criteria was added). Without this, adding a column here is a
# silent no-op locally (fresh DB, no problem) but crashes on any database
# that already has the old schema — exactly what took the bot down after
# commits c8feec9 and cc4adca. This is a stand-in for a real migration tool
# (Alembic) — fine at this scale, but if the schema keeps changing quickly
# it's worth switching to Alembic instead of growing this list by hand.
MANUAL_COLUMN_MIGRATIONS = [
    "ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS verification_criteria VARCHAR(500)",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verification_criteria VARCHAR(500)",
    "ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS batch INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS batch INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS music_nudges_sent INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS last_music_nudge_at TIMESTAMPTZ",
    "ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS description VARCHAR(500)",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description VARCHAR(500)",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_comment VARCHAR(500)",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS upsell_nudges_sent INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS batch_report_sent_at TIMESTAMPTZ",
    "ALTER TABLE stores ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION",
    "ALTER TABLE stores ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION",
    "ALTER TABLE stores ADD COLUMN IF NOT EXISTS radius_m INTEGER NOT NULL DEFAULT 300",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS geo_lon DOUBLE PRECISION",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS geo_distance_m INTEGER",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS geo_ok BOOLEAN",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS brewed_tea VARCHAR(200)",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS brewed_tea_feedback VARCHAR(2000)",
    "ALTER TABLE shift_logs ADD COLUMN IF NOT EXISTS treats_given INTEGER NOT NULL DEFAULT 0",
]


async def init_models() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for statement in MANUAL_COLUMN_MIGRATIONS:
            await conn.execute(text(statement))


def get_session() -> AsyncSession:
    return async_session()
