# Waystea

В репозитории живут два независимых проекта.

| Проект | Что это | Стек | Документация |
|---|---|---|---|
| [`teabot/`](ARCHITECTURE.md) | Telegram-бот, отвечающий на вопросы о китайском чае | Python, aiohttp, python-telegram-bot | [ARCHITECTURE.md](ARCHITECTURE.md) |
| [`warehouse/`](warehouse/README.md) | Мобильное приложение для склада: товары, приход, касса, отчёты | TypeScript, React Native (Expo), SQLite | [warehouse/README.md](warehouse/README.md) |

Проекты не связаны кодом и разворачиваются по отдельности: бот — на Render,
приложение — в App Store и Google Play.

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
npx expo start
```
