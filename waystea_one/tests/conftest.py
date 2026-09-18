"""Dummy env vars so `app.config` (and anything importing it) can be
collected without requiring real secrets — tests should run with just
`pip install -r requirements.txt && pytest`, per README.md.
"""
import os

os.environ.setdefault("BOT_TOKEN", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("OWNER_TELEGRAM_ID", "1")
