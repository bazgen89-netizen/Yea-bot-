# Waystea

В репозитории живут два независимых проекта.

| Проект | Что это | Стек | Документация |
|---|---|---|---|
| [`teabot/`](ARCHITECTURE.md) | Telegram-бот, отвечающий на вопросы о китайском чае | Python, aiohttp, python-telegram-bot | [ARCHITECTURE.md](ARCHITECTURE.md) |
| [`warehouse/`](warehouse/README.md) | Мобильное приложение для склада: товары, приход, касса, отчёты | TypeScript, React Native (Expo), SQLite | [warehouse/README.md](warehouse/README.md) |
| [`warehouse-server/`](warehouse-server/README.md) | Общий сервер склада: синхронизация устройств, сотрудники, открытый API | TypeScript, Fastify, PostgreSQL | [warehouse-server/README.md](warehouse-server/README.md) |

Бот и склад не связаны кодом и разворачиваются по отдельности: бот — на Render,
сервер склада — в Docker на любом хостинге, приложение — в App Store и Google Play.

## Быстрый старт

**Бот:**
```bash
pip install -r requirements.txt
python bot.py
```

**Приложение склада:**
```bash
cd warehouse
npm install --legacy-peer-deps
npm run web          # посмотреть в браузере
npx expo start       # запустить на телефоне через Expo Go
```

**Сервер склада:**
```bash
cd warehouse-server
cp .env.example .env   # впишите POSTGRES_PASSWORD
docker compose up -d
```
