import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    bot_token: str = os.environ["BOT_TOKEN"]
    database_url: str = os.environ["DATABASE_URL"]


settings = Settings()
