# WAYSTEA ONE — MVP

Implementation of the WAYSTEA ONE digital employee described in `../docs/`.
This slice covers MVP priority steps 1-6 from `../docs/08_MVP_REQUIREMENTS.md`
§14: Telegram connection, employee identification, store management, shift
control, daily tasks + verification, and reminders.

## What's here

- `app/models.py` — `Employee`, `Store`, `ShiftLog`, `TaskTemplate`, `Task`
  (PostgreSQL via SQLAlchemy async).
- `app/services/store_matcher.py` — resolves a store name from free-form text.
- `app/services/shift_detector.py` — recognizes "on site" shift-start phrasing.
- `app/services/identity.py` — employee/shift persistence.
- `app/services/tasks.py` — creates today's tasks from active templates when
  a shift starts, and handles completion (with or without photo/comment proof).
- `app/services/reminders.py` — polled by APScheduler (`app/main.py`); sends
  the 30/60-minute reminders and escalates to the owner if both are ignored
  (docs/02_OPERATION_SYSTEM.md §10).
- `app/handlers/shift.py` — the shift conversation flow:
  - unknown Telegram user → bot asks their name once and remembers them;
  - known employee sends a shift-start message → bot resolves the store from
    the message (or asks which store if it can't tell), then sends today's
    task checklist;
  - a "готово"-style reply or task comment/photo from a known employee is
    also handled here (single text handler — see the module docstring for
    why) and in `app/handlers/tasks.py` (buttons + photo proof).
  - Purchasing/Reporting/Sales modules are not built yet (next in the
    priority order).

## Design choices worth knowing about

- **Polling, not webhook.** `04_TECH_SPEC.md` left this open; polling was
  chosen for the MVP because it needs no public HTTPS endpoint and is
  simplest to run and test. Switching to webhook mode later (for scale) only
  touches `app/main.py`.
- **FSM storage is in-memory.** Fine for a single-process MVP; if the bot
  needs to run multiple workers or survive restarts without losing an
  in-progress onboarding/clarification dialog, swap `MemoryStorage` for
  `RedisStorage` (Redis is already in the stack for the reminder engine).
- **Store matching is deterministic, not LLM-based**, for MVP reliability —
  see the docstring in `shift_detector.py` for when to graduate to the AI
  Processing Layer instead.

## Running locally

```bash
cp .env.example .env      # fill in BOT_TOKEN and OWNER_TELEGRAM_ID
docker compose up --build
docker compose exec bot python -m scripts.seed_stores
docker compose exec bot python -m scripts.seed_task_templates
```

## Running tests

```bash
pip install -r requirements.txt
pytest
```

Tests cover the pure-function logic (`store_matcher`, `shift_detector`,
`tasks.is_completion_phrase`) and need no database or Telegram token.
