# WAYSTEA ONE — MVP

Implementation of the WAYSTEA ONE digital employee described in `../docs/`.
This slice covers all 10 MVP priority steps from `../docs/08_MVP_REQUIREMENTS.md`
§14: Telegram connection, identification, stores, shift control, daily
tasks + verification, reminders, purchasing, daily report, and the
revenue/upsell module. The one piece still missing is deeper memory/knowledge
Q&A (step 9 in the doc) — see "What's not here yet" below.

## What's here

- `app/models.py` — `Employee`, `Store`, `ShiftLog`, `TaskTemplate`, `Task`,
  `PurchaseRequest`, `ShiftRevenue`, `UpsellEvent` (PostgreSQL via SQLAlchemy async).
- `app/services/store_matcher.py` — resolves a store name from free-form text.
- `app/services/shift_detector.py` — recognizes "on site" shift-start phrasing.
- `app/services/identity.py` — employee/shift persistence.
- `app/services/tasks.py` — creates today's tasks from active templates when
  a shift starts, and handles completion (with or without photo/comment proof).
- `app/services/reminders.py` — polled by APScheduler (`app/main.py`); sends
  the 30/60-minute reminders and escalates to the owner if both are ignored
  (docs/02_OPERATION_SYSTEM.md §10).
- `app/services/purchasing.py` — turns "закончился X" style messages into
  `PurchaseRequest` rows (keyword heuristic, not real NLU — see the module
  docstring for when to graduate to the AI Processing Layer).
- `app/services/revenue.py` — parses the fixed three-line end-of-shift
  revenue report (docs/09_KPI_AND_REVENUE_MODULE.md §3.1); rejects and asks
  for clarification if a line is missing or cash + non-cash ≠ total.
- `app/services/upsell.py` — keyword-detects upsell mentions (tasting,
  pairing, extra tea) and sends one proactive nudge per employee per shift
  if nothing's been logged ~2 hours in.
- `app/services/reports.py` — assembles the daily owner report (attendance,
  task completion %, purchases, revenue, escalated/"problem" tasks).
- `app/handlers/shift.py` — the shift conversation flow, and also where
  task replies, purchase requests, revenue reports and upsell mentions are
  routed from, since aiogram sends a given text message to a single handler
  (see the module docstring for the exact priority order).
- `app/handlers/tasks.py` — task checklist buttons + photo proof.
- `app/handlers/owner.py` — `/report` command for the owner to pull the
  daily report on demand (it's also sent automatically every day, see
  `DAILY_REPORT_HOUR` below).

## What's not here yet

- Deeper Memory/Knowledge Engine (docs/03_AI_BRAIN.md §5-7) — answering
  free-form employee questions from a company knowledge base needs the AI
  Processing Layer wired to a real LLM, which this scaffold doesn't do yet
  (all detection here is keyword-based on purpose, for MVP reliability).
- Learning/Reflection Engine (docs/03_AI_BRAIN.md §8-10) — proactive pattern
  detection across days, not just within a shift.

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

The owner can also request the report on demand with `/report` (only
responds to `OWNER_TELEGRAM_ID`).

## Running tests

```bash
pip install -r requirements.txt
pytest
```

Tests cover the pure-function logic (`store_matcher`, `shift_detector`,
`tasks.is_completion_phrase`) and need no database or Telegram token.
