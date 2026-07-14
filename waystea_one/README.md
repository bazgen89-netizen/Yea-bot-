# WAYSTEA ONE — MVP

Implementation of the WAYSTEA ONE digital employee described in `../docs/`.
This slice covers all 10 MVP priority steps from `../docs/08_MVP_REQUIREMENTS.md`
§14: Telegram connection, identification, stores, shift control, daily
tasks + verification, reminders, purchasing, daily report, the
revenue/upsell module, and (step 9) company knowledge-base Q&A via the AI
Processing Layer — see "What's not here yet" for what's still missing beyond
the 10 MVP steps.

## What's here

- `app/models.py` — `Employee`, `Store`, `ShiftLog`, `TaskTemplate`, `Task`,
  `PurchaseRequest`, `ShiftRevenue`, `UpsellEvent` (PostgreSQL via SQLAlchemy async).
  `TaskTemplate`/`Task.description` carries the detailed instructions shown
  under a task's title in the checklist (e.g. what "banks with tea labeled
  and sealed" actually means) — `verification_criteria` stays internal,
  used only by the AI vision check.
- `app/services/store_matcher.py` — resolves a store name from free-form text.
- `app/services/shift_detector.py` — recognizes "on site" shift-start phrasing.
- `app/services/identity.py` — employee/shift persistence.
- `app/services/tasks.py` — creates every task for the day up front, but
  only reveals them a `batch` at a time (per owner decision: 3 simplest
  first, then batches of ~3-5) via `sent_at`; `advance_to_next_batch()`
  reveals the next batch once the current one is fully completed. Also
  handles completion (with or without photo/comment proof).
- `app/services/reminders.py` — polled by APScheduler (`app/main.py`); sends
  the 30/60-minute reminders and escalates to the owner if both are ignored
  (docs/02_OPERATION_SYSTEM.md §10). Counts from `Task.sent_at` (when the
  employee actually saw it), not `created_at` — a task sitting in a later,
  not-yet-revealed batch shouldn't start "aging" before it's shown.
- `app/services/purchasing.py` — turns "закончился X"/"X осталось" style
  messages into `PurchaseRequest` rows (keyword heuristic, not real NLU —
  see the module docstring for when to graduate to the AI Processing
  Layer). Trigger matching is whole-word only (`\b...\b`), not substring —
  a stem match once turned "остальные" ("the other ones") into a false
  purchase request.
- `app/handlers/tea_requests.py` — a dedicated "какой чай привезти"
  chat/topic (owner decision): every message there is treated as a tea
  restock request outright, no trigger-phrase detection needed, since
  writing there already means "bring this". The store comes from
  whichever store the sender is on shift at today, not from the message
  text. Configured via `TEA_REQUEST_CHAT_ID`/`TEA_REQUEST_THREAD_ID` (see
  `.env.example`); a no-op until `TEA_REQUEST_CHAT_ID` is set. Registered
  in `app/bot.py` before `shift.py`'s generic catch-all, same reasoning as
  `owner_router`.
- `app/services/revenue.py` — parses the fixed three-line end-of-shift
  revenue report (docs/09_KPI_AND_REVENUE_MODULE.md §3.1); rejects and asks
  for clarification if a line is missing or cash + non-cash ≠ total.
- `app/services/upsell.py` — keyword-detects upsell mentions (tasting,
  pairing, extra tea) and sends one proactive nudge per employee per shift
  if nothing's been logged ~2 hours in.
- `app/services/music.py` — owner request: "Включить музыку" and "Проверить,
  что музыка играет" are now in batch 1, and `send_music_nudges` proactively
  asks up to twice per shift what's playing and whether the volume is
  right. Unlike `upsell.py`'s nudge (which is fire-and-forget), the reply
  is actually captured: sets an FSM state (`MusicNudge.awaiting_response`)
  directly on the dispatcher's storage since this runs from a scheduler
  job, not a message handler, then `app/handlers/shift.py::receive_music_response`
  logs it into `MusicCheck` and it shows up in the daily owner report.
- `app/services/reports.py` — assembles the daily owner report (attendance,
  task completion %, purchases, revenue, escalated/"problem" tasks, music
  check-in notes).
- `app/handlers/shift.py` — the shift conversation flow, and also where
  task replies, purchase requests, revenue reports and upsell mentions are
  routed from, since aiogram sends a given text message to a single handler
  (see the module docstring for the exact priority order). Confirming a
  shift no longer goes straight to the checklist — it greets the employee
  by name and asks how they're doing (`MoodCheck` state); their reply gets
  one short AI-generated acknowledgement (`app/services/ai.py::chat_reply`)
  before the first batch of tasks is sent.
- `app/handlers/tasks.py` — task checklist buttons + photo proof. After any
  completion, checks whether the current batch is now fully done and, if
  so, sends the next one (`_reveal_next_batch_if_ready` in both this file
  and `shift.py`, since completion can happen via button or via text).
- `app/handlers/owner.py` — `/report` command for the owner to pull the
  daily report on demand (it's also sent automatically every day, see
  `DAILY_REPORT_HOUR` below). `/addknowledge` lets the owner grow the
  company knowledge base (used to answer employee questions) directly
  from Telegram — asks for a title, then content, then saves — instead
  of needing a code change for every new entry.
- `app/services/messaging.py` — routes every employee-facing reply
  (confirmations and clarifying questions — name, which store — alike) to
  the employee's private chat rather than wherever they wrote from (usually
  a group), per owner decision. Falls back to a group reply asking the
  employee to open a DM with the bot once if the private message fails —
  Telegram won't let a bot message someone who's never started a chat with
  it. Multi-turn dialogs (name → store) are scoped per-user rather than
  per-chat (`FSMStrategy.GLOBAL_USER` in `app/bot.py`) so a question asked
  in the group can be answered in the private chat without losing track.
- `app/services/ai.py` — the AI Processing Layer. Calls an LLM (Claude, via
  `ANTHROPIC_API_KEY`) for exactly one thing right now: the short
  acknowledgement after the mood-check question (`chat_reply`).
  `answer_employee_question` (knowledge-base Q&A) still lives here but
  isn't called from any handler — per owner decision (docs/06_PROJECT_LOG.md
  Decision 29), the bot's scope for now is only shift/store identification
  plus assigning and checking tasks, so an employee question is escalated
  straight to the owner (`app/handlers/shift.py::_try_handle_question_reply`)
  instead of being answered by the AI layer. Re-wire that one call site to
  bring Q&A back.
- `app/services/vision.py` — the vision counterpart to `ai.py`. When a task
  (`TaskTemplate.verification_criteria`) specifies what a valid photo should
  show, submitted photos are checked against that description via Claude's
  vision input instead of being accepted automatically. Same fail-open
  behavior as `ai.py`: no API key, or the call erroring, means the photo is
  accepted as before rather than blocking the employee on an AI outage.
  **Currently unused by the seeded checklist** — every template in
  `scripts/seed_task_templates.py` is comment-proof for now, per owner
  request, until reference photos for calibration are ready; the
  `verification_criteria` text is kept on those templates so switching a
  given task back to `ProofType.PHOTO` later is a one-line change.
  `app/services/tasks.py::sync_stale_tasks_to_templates` (run at every
  boot) handles template edits in general: any not-yet-completed `Task`
  row whose `requires_proof`/`proof_type`/`verification_criteria` has
  drifted from its current template gets re-synced (and auto-closes if the
  template no longer requires proof at all), so an employee never gets
  stuck on a requirement — photo or otherwise — the checklist doesn't
  actually have anymore.
- `app/services/intent.py` — AI Processing Layer fallback for store-name
  resolution. `store_matcher.py`'s exact alias matching runs first (free,
  instant); only if that fails does `resolve_store()` ask Claude which of
  the known stores the message means, before the bot gives up and asks the
  employee to clarify. Same fail-open contract as `ai.py`/`vision.py`.
- `scripts/seed_knowledge_base.py` seeds two placeholder entries; replace/
  expand with real WAYSTEA instructions.

## What's not here yet

- Learning/Reflection Engine (docs/03_AI_BRAIN.md §8-10) — proactive pattern
  detection across days ("this task is late every Monday"), not just
  within a single shift.
- Real retrieval for the knowledge base — right now the whole
  `KnowledgeEntry` table is passed as LLM context every time, which is fine
  at MVP scale (a handful of entries) but would need pgvector or similar
  once the knowledge base grows large.

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
- **`app/health.py` is a hosting accommodation, not a product feature.**
  Render's free tier only exists for Web Services, which must answer HTTP
  on `$PORT` — so `app/main.py` also starts a one-route health server
  alongside the Telegram polling loop. A free Web Service on Render sleeps
  after ~15 minutes with no HTTP traffic and cold-starts on the next
  request. `.github/workflows/waystea-keep-alive.yml` pings the health URL
  every 10 minutes via a scheduled GitHub Actions run so the bot doesn't
  need to be re-woken manually before each use — swap in an external
  monitor (e.g. UptimeRobot) instead if you'd rather not rely on GitHub
  Actions' scheduling. Render's own crash recovery is separate and already
  automatic — this only prevents the inactivity-sleep case.
- **Seeding runs on every boot, not by hand.** Free Render Web Services also
  don't include Shell/One-Off Job access, so there's no way to run
  `python -m scripts.seed_stores` interactively after deploy. `app/main.py`
  calls all three seeders itself on startup instead; they're written to be
  safe to re-run (each checks for existing rows first).

## Running locally

```bash
cp .env.example .env      # fill in BOT_TOKEN, OWNER_TELEGRAM_ID, and (optionally) ANTHROPIC_API_KEY
docker compose up --build
```

`app/main.py` runs all three `scripts/seed_*` seeders on every boot (they're
idempotent — each checks for existing rows first), specifically so this
works on hosts with no shell/one-off-job access (e.g. Render's free Web
Service tier — see "Design choices" below). Run them by hand instead only
if you need to, e.g. `docker compose exec bot python -m scripts.seed_stores`.

Without `ANTHROPIC_API_KEY` set, employee questions still get a polite
"I don't have that configured yet" reply instead of an error — see
`app/services/ai.py`.

The owner can also request the report on demand with `/report` (only
responds to `OWNER_TELEGRAM_ID`).

**Operational note:** each employee needs to open a private chat with the
bot at least once (find it in Telegram, press Start) before it can send
them confirmations privately — see `app/services/messaging.py`. Until they
do, they'll get a one-time nudge in the group asking them to.

Also, for the bot to see ordinary group messages at all (not just ones
that mention it), it needs either group-admin status or Privacy Mode
disabled via @BotFather → your bot → Bot Settings → Group Privacy → Turn
off.

## Running tests

```bash
pip install -r requirements.txt
pytest
```

`tests/conftest.py` sets dummy env vars so the whole suite (including
modules that import `app.config`) collects without real secrets. Tests
otherwise cover pure-function logic (`store_matcher`, `shift_detector`,
`tasks.is_completion_phrase`, `purchasing`, `revenue`, `upsell`,
`question_detector`) and the AI layer's no-key/no-knowledge-base fallback
paths — none of it needs a live database, Telegram token, or Anthropic key.
