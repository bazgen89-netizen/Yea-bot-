# WAYSTEA ONE
# Project Development Log

Version: 1.1

---

# Project Purpose

This document stores the history of decisions, changes and important events during the development of WAYSTEA ONE.

It is the memory of the project development process.

---

# Project Vision

WAYSTEA ONE is an AI digital employee created to reduce owner's daily operational workload while maintaining company standards, employee performance and service quality.

The goal is not to create a simple chatbot.

The goal is to create an intelligent operational partner for WAYSTEA.

---

# Current Project Status

Status:

Implementation in progress. All 10 MVP priority steps are scaffolded in
`waystea_one/`, including step 9 (company knowledge-base Q&A via a real
Claude API call). Not yet run against a real Telegram token or a real
Anthropic API key. The remaining open item is the deeper Learning/
Reflection Engine (docs/03_AI_BRAIN.md §8-10), which this scaffold doesn't
have yet.

Created documents:

✅ 01_PRODUCT_VISION.md
Product vision and AI employee identity.

✅ 02_OPERATION_SYSTEM.md
Operational processes and employee workflows.

✅ 03_AI_BRAIN.md
AI logic, memory and decision-making system.

✅ 04_TECH_SPEC.md
Technical architecture requirements (original source document was cut off;
architecture/stack/data-model sections were completed during planning with Claude).

✅ 05_CLAUDE_INSTRUCTIONS.md
Instructions for AI developer.

✅ 06_PROJECT_LOG.md
This document.

✅ 07_BUSINESS_CONTEXT.md
Company, stores, brand, operational problems.

✅ 08_MVP_REQUIREMENTS.md
MVP scope.

✅ 09_KPI_AND_REVENUE_MODULE.md
Success metrics and the sales/upsell tracking module.

---

# Initial Business Problem

The owner spends too much time on operational control:

- checking employee attendance;
- reminding about tasks;
- collecting information;
- controlling processes;
- solving repetitive questions.

WAYSTEA ONE is designed to remove this routine.

---

# Important Decisions

## Decision 1

WAYSTEA ONE is not a simple Telegram bot.

It must be developed as an AI operational platform.

Date:

Initial project stage.

---

## Decision 2

Telegram is the first interface.

Reason:

Employees already use Telegram.

No additional application installation is required.

---

## Decision 3

AI must have memory.

Memory must include:

- company knowledge;
- store information;
- employee history;
- owner decisions.

---

## Decision 4

AI acts independently only within approved limits.

AI does not:

- punish employees;
- make financial decisions;
- change business rules.

---

## Decision 5

Date: 2026-07-13

Decision:

The repository already contained an unrelated bot (`bot.py`, a Groq-based
"Tea Expert" Q&A bot with an affiliate promo insert). This is not the WAYSTEA
ONE system and is not used as a starting point. WAYSTEA ONE is built fresh,
following the architecture in 04_TECH_SPEC.md.

Reason:

The existing bot solves a different problem (public tea Q&A) with a different
stack and no connection to the operational model described in these documents.

Impact:

Development starts from a clean module structure. Resolved: the owner chose to
archive rather than delete it — moved to `archive/old_tea_qa_bot/` with a short
README explaining why it's kept and that it's not part of the WAYSTEA ONE build.

---

## Decision 6

Date: 2026-07-13

Decision:

Employee-to-store assignment is dynamic, not a fixed schedule. Every employee
can work at any of the three stores on any given day. The store is determined
each morning from the employee's own "on site" message (with fuzzy matching on
store name/aliases), and the AI asks a clarifying question if the store cannot
be determined confidently.

Reason:

Confirmed directly by the owner — staff rotates between locations.

Impact:

Shift Engine design does not depend on a pre-loaded schedule. `ShiftLog` is
written per employee per day, not looked up from a static roster.

---

## Decision 7

Date: 2026-07-13

Decision:

Employee identity is Telegram user_id + a name confirmed by the AI on first
contact (not assumed from the Telegram display name, which can be a nickname).

Reason:

Owner confirmed this is more reliable than trusting Telegram profile names.

Impact:

Identity/Employee Module always runs a one-time "what is your name" step for
unrecognized Telegram user_ids before treating the person as a known employee.

---

## Decision 8

Date: 2026-07-13

Decision:

A revenue/upsell tracking module is added to the MVP scope (Sales/Revenue
Module), because the owner's current priority is growing revenue, which was
low. Since the CloudShop POS has a closed API and cannot be integrated,
revenue and upsell data are self-reported by employees through the chat:
total revenue, cash, non-cash at shift close; upsell events (extra tea,
snacks/pairings, tasting-to-purchase) during the day. The AI may nudge/remind
employees to upsell in the moment and reports aggregated data plus any
employee-level rating only to the owner — never to the employee — per the
existing rule that AI does not evaluate or judge employees on its own
authority (03_AI_BRAIN.md §14, 01_PRODUCT_VISION.md §8).

Reason:

Direct request from the owner; reconciled against the AI safety rules already
defined in the documentation.

Impact:

New entities `ShiftRevenue` and `UpsellEvent`; new Sales/Revenue Module; new
KPI list in 09_KPI_AND_REVENUE_MODULE.md. Data quality caveat: figures are
self-reported and not cross-validated against POS.

---

# Development Rules

Every major decision should be recorded here.

Format:

Date:

Decision:

Reason:

Impact:

---

# Future Ideas

Ideas that appeared but are not implemented yet:

- AI HR system;
- AI training assistant;
- inventory prediction;
- analytics dashboard;
- voice interaction;
- multi-company version.

---

# Development History

## Entry 1

Date:

Description:

Created initial project documentation.

Result:

WAYSTEA ONE concept formalized.

---

## Entry 2

Date: 2026-07-13

Description:

Reviewed all 8 planning documents with Claude, resolved open questions on
employee onboarding, store assignment, owner role, POS integration, MVP
rollout scope, task-completion criteria, and revenue/upsell KPIs. Proposed
architecture, tech stack and MVP build order accepted.

Result:

Project ready to move from documentation phase into implementation.

---

## Decision 9

Date: 2026-07-13

Decision:

MVP scaffold (`waystea_one/`) built covering priority steps 1-4 from
08_MVP_REQUIREMENTS.md §14: Telegram connection, employee identification,
store management, shift control. Telegram integration uses long polling, not
webhook — 04_TECH_SPEC.md had left this open; polling needs no public HTTPS
endpoint and is simplest to run/test for MVP. Webhook remains an option for
a later, higher-scale deployment.

Reason:

Get a runnable, testable slice first; defer infra (webhook + reverse proxy)
until it's actually needed.

Impact:

`waystea_one/app/main.py` calls `start_polling`. FSM state (onboarding /
store-clarification dialogs) uses aiogram's in-memory storage for now —
fine for a single process, would need Redis-backed storage before running
multiple workers.

---

## Decision 10

Date: 2026-07-13

Decision:

Added priority steps 5-6 from 08_MVP_REQUIREMENTS.md §14 to the scaffold:
Task Engine (daily checklist created from `TaskTemplate` rows when a shift
is confirmed; completion via inline button or a "готово"-style reply;
photo/comment proof for tasks that require it) and the Reminder Engine
(APScheduler polling job — 30-minute and 60-minute reminders, then one
owner escalation if both are ignored, per 02_OPERATION_SYSTEM.md §10).

Reason:

Natural continuation once shift control worked — tasks only became useful
once they could actually be sent, closed, and chased up.

Impact:

New models `TaskTemplate`/`Task`; new `app/services/tasks.py`,
`app/services/reminders.py`, `app/handlers/tasks.py`; `scripts/seed_task_templates.py`
seeds the default daily checklist. Task completion is collapsed to
CREATED → WAITING_PROOF → COMPLETED for MVP (see the `TaskStatus` docstring
in `app/models.py` for why Received/In Progress aren't separate states yet).

---

## Decision 11

Date: 2026-07-13

Decision:

Added priority steps 7, 8 and 10 from 08_MVP_REQUIREMENTS.md §14 to the
scaffold: Purchasing (keyword-detects "закончился/нет/нужны ..." and creates
a `PurchaseRequest`), the daily owner report (built from shifts/tasks/
purchases/revenue/escalated tasks, sent automatically every day and
available on demand via `/report`), and the Sales/Revenue module from
09_KPI_AND_REVENUE_MODULE.md (fixed three-line revenue parser, upsell
keyword detection, and a one-per-shift proactive upsell nudge). Step 9
(deeper Memory/Knowledge Engine — free-form Q&A from the company knowledge
base) is deliberately skipped for now.

Reason:

These three steps were all reachable with the same keyword-heuristic
approach already used for shift/task detection, so they could be built
without first wiring a real LLM. Step 9 genuinely needs that LLM connection
(docs/04_TECH_SPEC.md §3.1, AI Processing Layer) to be worth building —
doing it with keywords would just be a worse version of the Task/Purchasing
detectors, not a knowledge base.

Impact:

New models `PurchaseRequest`, `ShiftRevenue`, `UpsellEvent`; new
`app/services/purchasing.py`, `revenue.py`, `upsell.py`, `reports.py`; new
`app/handlers/owner.py` for `/report`. All new text-message detection lives
in the same `app/handlers/shift.py` dispatch chain as before (task reply →
revenue → purchase/upsell), since aiogram routes one text message to one
handler.

---

## Decision 12

Date: 2026-07-13

Decision:

Wired the AI Processing Layer (docs/04_TECH_SPEC.md §3.1) to the Claude API
for step 9 (company knowledge-base Q&A, docs/03_AI_BRAIN.md §7). A new
`KnowledgeEntry` table holds Company Memory; the whole table is passed as
LLM context on each question (fine at MVP scale, a handful of entries).
Detection of "this looks like a question" stays keyword/punctuation-based
(question words, trailing "?") — only the actual answer generation calls
the LLM. If `ANTHROPIC_API_KEY` isn't set, or the knowledge base is empty,
or the API call fails, the bot returns a plain-language fallback instead of
crashing or inventing an answer (docs/03_AI_BRAIN.md §13).

Reason:

This was the one MVP step that couldn't be done with a keyword heuristic
without just being a worse version of the other detectors — it genuinely
needs an LLM to answer open-ended employee questions.

Impact:

New model `KnowledgeEntry`; new `app/services/ai.py`, `knowledge.py`,
`question_detector.py`; `scripts/seed_knowledge_base.py` seeds two
placeholder entries (customer complaints, Da Hong Pao brewing) that the
owner should replace with real WAYSTEA instructions. Question-answering is
the last step in `app/handlers/shift.py`'s dispatch chain (task reply →
revenue → purchase/upsell → question), so nothing else swallows it first.
Added `tests/conftest.py` since the AI layer's tests import `app.config`,
which previously required real env vars just to collect — it now sets
dummy values so `pytest` still needs no real secrets.

---

## Decision 13

Date: 2026-07-13

Decision:

Deploying the MVP to Render as a free-tier **Web Service** rather than a
Background Worker, which Render only offers on paid plans. Since the bot
talks to Telegram via polling (Decision 9) and has no inbound HTTP endpoint
of its own, added a one-route health server (`app/health.py`) that answers
on `$PORT` purely so Render's free Web Service tier accepts the deployment.
It runs alongside the polling loop and reminder/report scheduler in the
same process.

Reason:

Avoid a paid hosting tier for the MVP; this is a hosting-platform
accommodation, not a product requirement, so it's kept out of `docs/`
proper and documented only in `waystea_one/README.md`.

Impact:

New `app/health.py`; `app/main.py` now also starts the health server;
new `PORT` setting in `app/config.py` (defaults to 8080, Render sets it
automatically). Trade-off accepted: a free Web Service on Render sleeps
after ~15 minutes without HTTP traffic and cold-starts on the next
request — the bot can have gaps in responsiveness unless something pings
the health URL periodically. Fine for testing the MVP; worth revisiting
(a small paid instance, or another host) once this is real daily-use
infrastructure for the business.

---

## Decision 14

Date: 2026-07-13

Decision:

Moved the three `scripts/seed_*` seeders from "run by hand after deploy" to
"run automatically on every boot", called from `app/main.py`. Render's free
Web Service tier (Decision 13) has no Shell or One-Off Job access, so there
was no way to run them interactively at all on that tier.

Reason:

Only way to seed stores/task templates/knowledge base on a host with no
shell access. All three seeders already checked for existing rows before
inserting (written that way from the start so they could be re-run safely),
so calling them on every startup has no downside beyond a few extra no-op
queries at boot.

Impact:

`app/main.py` now imports and awaits `seed_stores()`, `seed_task_templates()`,
`seed_knowledge_base()` before starting the bot. The scripts are still
runnable standalone (`python -m scripts.seed_stores`) for hosts that do have
shell access.

---

## Decision 15

Date: 2026-07-13

Decision:

Bot confirmations/results (shift confirmed + checklist, task done,
revenue/purchase recorded, knowledge-base answers) now go to the
employee's private chat instead of replying in the group where they wrote
the trigger message. Clarifying questions (name on first contact, which
store) stay as group replies, since a brand-new employee has no private
chat with the bot yet and Telegram forbids a bot from DMing someone who
hasn't started a conversation with it.

Reason:

Owner request — revenue figures and personal task lists showing up in the
shared group chat isn't appropriate; only the "everyone, who's on shift
today" style group nudges (not yet built — see 02_OPERATION_SYSTEM.md §5)
were meant to be public.

Impact:

New `app/services/messaging.py::notify_employee` — tries a private
message, falls back to a one-time group nudge ("please open a DM with the
bot") if that fails, so nothing silently disappears for employees who
haven't started a private chat yet. `app/handlers/tasks.py::send_daily_checklist`
signature changed to take `(bot, employee, tasks, fallback_message)`
instead of just `(message, tasks)`. Also surfaced two Telegram-side
requirements the owner hit while testing live: the bot needs either
group-admin rights or Privacy Mode disabled (via @BotFather) to see
ordinary group messages at all, and each employee must open a private chat
with the bot once before it can message them there — both now documented
in `waystea_one/README.md`.

---

## Decision 16

Date: 2026-07-13

Decision:

Extended Decision 15's private-chat routing to clarifying questions too
(name on first contact, which store) — not just confirmations. Also
switched the FSM scoping from aiogram's default (per-chat) to
`FSMStrategy.GLOBAL_USER` (per-user, across chats), and added a plain
`/start` reply so opening a DM with the bot isn't silent.

Reason:

Found live while testing on Render: with per-chat FSM scoping, a question
asked in the group and answered in the employee's private chat wouldn't
have been recognized as the answer — aiogram would treat it as an
unrelated new message in a different chat. GLOBAL_USER scoping fixes that
generally, which then made it safe to route the remaining group-only
messages (name, store clarification) through the same
private-with-group-fallback pattern as everything else, since a failed
private send still safely falls back to the group.

Impact:

`app/bot.py` now constructs `Dispatcher(..., fsm_strategy=FSMStrategy.GLOBAL_USER)`.
`app/services/messaging.py` gained `send_private()` (works before an
`Employee` row exists, using the raw Telegram user id + Telegram profile
name) alongside the existing `notify_employee()`. `app/handlers/shift.py`'s
onboarding and store-clarification prompts now go through these instead of
`message.reply()`. `app/handlers/owner.py` gained a `/start` handler purely
so pressing Start isn't silent — the important effect (unlocking private
messaging) already happens on Telegram's side the moment the user sends
anything to the bot in private, regardless of whether the bot replies.

---

## Decision 17

Date: 2026-07-13

Decision:

Added real photo verification instead of accepting any photo as task
proof. `TaskTemplate`/`Task` gained `verification_criteria` (free text
describing what a valid photo should show); `app/services/vision.py` sends
the submitted photo plus that description to Claude's vision input and
asks for a pass/fail judgment with a short explanation. On fail, the
employee gets the explanation and is asked to resend — the task stays
`WAITING_PROOF`, not completed. Also expanded the default checklist
(`scripts/seed_task_templates.py`) from 4 generic items to 7 more specific
ones per owner feedback ("very few tasks, too shallow"), and fixed the
checklist buttons showing a ✅ prefix on every task before anything was
done (confusing — looked like tasks were already complete) by relabeling
them "Отметить: {title}".

Reason:

Direct owner request: bots that just accept any photo as "proof" aren't
actually verifying anything. Owner also flagged the criteria as too vague
initially (just "cleanliness") and asked for specifics: workspace
cleanliness, clean cups/teapots, whether everything is laid out on the tea
board (чабань), whether the tea board itself is clean — folded into the
criteria text for the relevant checklist items. Owner said reference
photos for calibration are coming later; not blocking on those now.

Impact:

New `app/services/vision.py::verify_photo` (same fail-open pattern as
`ai.py` — no API key or an error means "accept the photo", not "block the
employee"). `scripts/seed_task_templates.py` changed from insert-if-missing
to upsert-by-title, so editing this list actually updates already-seeded
rows (needed since `app/main.py` runs it on every boot) — and it now also
deactivates global templates whose title dropped out of the list, so
renamed/retired items don't linger as active tasks. Follow-up once
reference photos arrive: attach them as additional images in the
`verify_photo` call for a same-image comparison instead of relying on text
description alone. Also still open: what specific KPI the owner wants
tied to these checklist items beyond the existing MVP KPI list in
09_KPI_AND_REVENUE_MODULE.md — asked for clarification, not yet built.

---

## Decision 18

Date: 2026-07-13

Decision:

Expanded the default checklist from 8 to 22 items, per owner picks across
four categories: consumables (milk/syrups/juice, disposable cups,
packaging, napkins), cash/accounting (change money, receipt tape, tea jars
labeled and closed), equipment (light bulbs, scale cleanliness/calibration,
water cooler temperature, ventilation), and display (wiping dust,
sale-dishware condition). Water-for-tea check also added per owner request.

Reason:

Direct owner selection from a proposed list of additional tea-shop-specific
tasks; owner explicitly excluded a standalone sugar item and added juice
instead.

Impact:

`scripts/seed_task_templates.py` now has 22 `TaskTemplate` rows (up from 8).
Photo-verified ones (jars labeled/closed, scale cleanliness, dust-free
display, sale-dishware condition) got `verification_criteria` text; the
rest are comment-based checks (quantity/state reports that don't lend
themselves to a single photo). This is a lot of tasks for one shift-start
checklist — worth watching whether employees find it overwhelming in
practice; nothing in the design prevents splitting this into "opening" vs
"closing" checklists later if so (docs/02_OPERATION_SYSTEM.md §13 already
describes a separate closing checklist, not yet built — see Current Next
Steps).

---

## Decision 19

Date: 2026-07-13

Decision:

Temporarily switched every photo-proof checklist item to comment-proof
(`scripts/seed_task_templates.py`), and sharpened the "workplace" and
"cups & teapots" criteria wording (floors washed, counter dust-wiped, no
drips on teapots) per owner feedback.

Reason:

Owner said photo verification isn't needed yet ("пока фотоотчет не
нужен") — reference photos for calibrating the vision check are still
being prepared and will come later.

Impact:

All templates are `ProofType.COMMENT` for now; `verification_criteria`
text is left in place on the affected rows (unused while `proof_type` is
COMMENT) so re-enabling photo verification per task is a one-line change
once reference photos arrive. `app/services/vision.py` itself is
unchanged — still tested, just not exercised by the seeded checklist.

---

## Decision 20

Date: 2026-07-13

Decision:

Fixed a real production bug that took the bot down: `init_models()` only
calls `Base.metadata.create_all`, which creates tables that don't exist
yet but does **not** add new columns to tables that already exist on a
live database. Render's Postgres already had `task_templates`/`tasks` from
before `verification_criteria` was added (Decision 17), so every deploy
since then crashed at startup with `UndefinedColumnError`. `app/db.py` now
also runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for the columns
added so far, as a stand-in for a real migration tool.

Reason:

Found live: two consecutive Render deploys failed ("Exited with status
1"), which is why the bot appeared to stop responding entirely — Render
correctly kept serving the last successfully deployed (older) version
rather than swapping to a broken one, but that older version didn't have
the fixes from the two failed commits either.

Reproduced locally before pushing the fix: built a local Postgres,
created the old schema, dropped the new column to match Render's actual
state, ran the current seeders against it to confirm the crash, applied
the fix, and confirmed the seeders now run cleanly against that same
old-schema database.

Impact:

`app/db.py::MANUAL_COLUMN_MIGRATIONS`. This approach doesn't scale well —
if the schema keeps changing, this should become a real Alembic migration
instead of a hand-maintained list of `ALTER TABLE` statements. Also
explains the separate symptom the owner reported ("reminders fire
immediately, not after 30 minutes"): while deploys were failing, test
tasks from earlier sessions sat open for well over 30-60 minutes; the
first successful boot after the fix finds them already overdue and
reminds right away. That's correct behavior for a backlog, not a
recurring bug — newly created tasks will wait the full 30/60 minutes as
designed. Owner also asked for a watchdog that restarts the bot on crash;
noted in reply that Render already auto-restarts a crashed process — the
actual gap is free-tier sleep-on-inactivity, which needs an external
uptime ping (e.g. UptimeRobot), not a custom watchdog.

---

## Decision 21

Date: 2026-07-13

Decision:

Added an AI Processing Layer fallback for store-name resolution
(`app/services/intent.py::resolve_store`). Exact alias matching
(`store_matcher.py`) still runs first and handles the common case for
free with no network call; only when that fails does the bot ask Claude
which of the three known stores the message means, before giving up and
asking the employee to clarify. Wired into all three places `shift.py`
resolves a store: the initial shift-start message, the post-onboarding
pending message, and the explicit clarification answer.

Reason:

Owner feedback: the bot "understands poorly," is "dumb" — traced to
deterministic keyword/alias matching missing phrasing outside the fixed
list. Full autonomous self-modifying behavior (the owner's literal ask —
"pull a skill for creating agents," "should correct itself") isn't
something to build — a bot that rewrites its own logic in production
isn't safe or standard practice. What's actually buildable and directly
addresses the complaint is using the already-configured Claude API to
understand phrasing the hand-written detectors don't cover, as a fallback
behind the deterministic fast path, not a replacement for it.

Impact:

New `app/services/intent.py` (`match_store_with_ai`, `resolve_store`).
Same fail-open contract as `ai.py`/`vision.py`: no API key or an error
returns None, so the caller's existing clarifying-question behavior is
unchanged, just reached less often. Good candidate for the same treatment
next: `is_completion_phrase` (task done detection) and
`purchasing.py::extract_product` are still pure keyword/regex and would
benefit from the same "deterministic first, AI fallback second" pattern
if the owner keeps hitting phrasing those don't recognize.

---

## Decision 22

Date: 2026-07-14

Decision:

Reworked the shift-start-to-task flow per owner's specific spec: (1) after
the store is confirmed, greet the employee by name, wish them a good day,
and ask how they're doing; (2) their reply gets one short, warm
AI-generated acknowledgement (not scripted, not a new question) before
anything else; (3) only then does the first batch of tasks go out — 3
simplest first, then batches of ~3-5 as each batch is fully completed, not
all 22 at once. Reminders (already per-task, not per-block — confirmed
this was already correct) now count from when a task's batch was actually
revealed (`sent_at`), not when the Task row was created in the DB.

Reason:

Direct owner spec, in response to the "bot understands poorly" complaint —
this is the conversational/pacing half of that fix (Decision 21 was the
understanding half).

Impact:

New `Task.batch`/`sent_at` and `TaskTemplate.batch` columns (added to
`app/db.py`'s manual migration list too — tested against a simulated old
schema before pushing, same as Decision 20). `scripts/seed_task_templates.py`
now assigns each of the 22 templates a batch (6 batches: 3, 4, 4, 5, 5, 1).
`create_daily_tasks_for_shift` still creates all 22 Task rows up front
(so completion/reminder bookkeeping has somewhere to live) but only
stamps `sent_at` on batch 1; `advance_to_next_batch` reveals the next one
once every currently-visible task is COMPLETED. New `MoodCheck` FSM state
and `app/services/ai.py::chat_reply` (same fail-open contract as the rest
of the AI Processing Layer — no API key means a generic friendly line
instead of silence). Verified end-to-end against a real local Postgres
before pushing: batch-1-only on creation, no early advance while a task's
still open, batch-2 reveal on completion, all 22 rows present with only
the sent ones counted as "open."

---

## Decision 23

Date: 2026-07-14

Decision:

Two fixes plus one infra addition: (1) `downgrade_stale_photo_tasks`
(run at every boot) converts any already-created `Task` row still stuck
on `ProofType.PHOTO` (from before photo proof was disabled, Decision 19)
to comment-proof, so an employee never gets stuck being asked for a photo
the checklist no longer requires. (2) Reworded the upsell nudge
(`UPSELL_NUDGE_TEXT`) — the old wording ("пока собираешь заказ") assumed
an in-progress customer order and read as nonsensical noise outside that
moment; now it's a generic "remember to offer tastings/pairings" reminder.
(3) Added `.github/workflows/waystea-keep-alive.yml`, a scheduled GitHub
Actions job pinging the health endpoint every 10 minutes, addressing
Render's free-tier inactivity sleep without needing a third-party account
(UptimeRobot etc.) — done via GitHub Actions since that's infra already
under this session's access, unlike Render or a monitoring service.

Reason:

(1) and (2) are real bugs/UX issues hit live while testing. (3) is the
practical equivalent of the "watchdog that restarts the bot" the owner
asked for, given no access to third-party accounts on their behalf; crash
recovery itself is already automatic on Render regardless.

Impact:

`app/services/tasks.py::downgrade_stale_photo_tasks`, called from
`app/main.py` right after seeding. Verified against a real local Postgres
with a simulated stuck task before pushing. New workflow file — GitHub
disables scheduled workflows after 60 days of repo inactivity, worth
remembering if pings mysteriously stop.

---

## Decision 24

Date: 2026-07-14

Decision:

Added a music check-in feature per owner request: two new batch-1 tasks
("Включить музыку", "Проверить, что музыка играет"), plus a proactive
check-in up to twice per shift asking what's playing and whether the
volume is right (`app/services/music.py::send_music_nudges`) — reused the
same "ask a question, capture the reply via a dedicated FSM state" pattern
as `MoodCheck`, but since this nudge fires from a scheduler job rather
than in response to a message, it sets the FSM state directly on the
dispatcher's storage. Replies are logged (`MusicCheck` table) and rolled
into the daily owner report, not just acknowledged and discarded like the
upsell nudge.

Also added `/addknowledge` (`app/handlers/owner.py`): an owner-only FSM
flow (title, then content) that lets the owner grow the company knowledge
base directly from Telegram, since the owner asked how to get better
answers out of the bot and the honest answer was "the knowledge base only
has 2 placeholder entries — it needs real content, and that shouldn't
require a code change every time."

Reason:

Direct owner requests — the music feature as its own spec, `/addknowledge`
in response to "how do I talk to it so it answers well."

Impact:

New `MusicCheck` table; new `music_nudges_sent`/`last_music_nudge_at`
columns on `ShiftLog` (added to `app/db.py`'s manual migration list).
`app/services/knowledge.py::create_knowledge_entry`. Verified both features
end-to-end against a real local Postgres before pushing (music: batch-1
task count, nudge timing/dedup, FSM state set correctly via the scheduler
path, reply captured and shown in the report; addknowledge: full
title→content→save flow, confirmation message, DB row created).

Also flagged to the owner separately: the AI Processing Layer returning
its generic error fallback on every question (not just unknown-topic ones)
almost always means the Anthropic API key has no billing/credits set up
on console.anthropic.com, or got mangled by whitespace when pasted into
Render — not a code bug. Worth checking that before assuming otherwise.

---

## Decision 25

Date: 2026-07-14

Decision:

Generalized `downgrade_stale_photo_tasks` (Decision 23, photo-only) into
`sync_stale_tasks_to_templates`: for any not-yet-completed task, re-syncs
`requires_proof`/`proof_type`/`verification_criteria` from its current
template on every boot, and auto-closes it if the template no longer
requires proof at all. Also set "Проверить, что музыка играет" to
no-proof — it was asking for a comment on what's meant to be a quick
yes/no glance.

Reason:

Owner hit the same underlying issue again, this time for "Включить
музыку"/light-check tasks demanding a comment: editing
`scripts/seed_task_templates.py` only affects new tasks, never
already-created ones for someone's current shift. The photo-specific fix
was too narrow — any future proof-requirement edit would hit the same
bug, so this closes the whole class rather than patching one more
instance of it.

Impact:

`app/services/tasks.py::sync_stale_tasks_to_templates` replaces
`downgrade_stale_photo_tasks` (same call site in `app/main.py`). Verified
against a real local Postgres: a simulated stale comment-required task
gets its `requires_proof` corrected AND auto-completes once its template
no longer requires proof, matching what an employee actually needs to
see.

---

## Decision 26

Date: 2026-07-14

Decision:

Added a `description` field to `TaskTemplate`/`Task` (shown under the
title in the checklist message, alongside the "Отметить: ..." button) so
detailed instructions can be attached to a task instead of only living in
`verification_criteria` (which is internal, AI-vision-only, and never
shown to the employee). Used it to expand the tea-jar task and added two
new batch-3 tasks: checking jar fill levels (top up if low/empty) and
comparing the tea in the cabinets against the inventory list on the
cabinet doors (write the current quantity into that list). Moved the
lighting check ("Проверить освещение") to batch 1, per owner request that
it be one of the very first things checked. Replaced "Проверить
кулер/бойлер" (there's no water cooler) with "Проверить чайник" (turns
on, temperature sets, heats). Kept the ventilation/AC check, and added a
Гагарина-only "Проверить вытяжку" (exhaust hood) task — the seeder now
supports per-store templates via an optional `store_name` key resolved to
`Store.id` at seed time, in addition to the global (`store_id=NULL`)
ones.

Reason:

Owner's detailed criteria for the jar/cabinet tasks ("подписаны все или
нет, в надлежащем аккуратном виде, закрыты плотно, резинки на месте",
plus separate fill-level and cabinet-vs-door-list checks) didn't fit in a
short task title, and had nowhere else to go that the employee would
actually see.

Impact:

New `description` column on both tables (manual migration in `app/db.py`,
same pattern as every other schema change so far).
`create_daily_tasks_for_shift` copies it onto new `Task` rows;
`sync_stale_tasks_to_templates` now also re-syncs `description` for
already-created tasks, same as the other template-drift fields.
`send_daily_checklist` renders it as an indented line under the task
title. Verified against a real local Postgres: seeded templates show the
right batch placement, descriptions, and the store-scoped hood task
resolves to the correct store id; a full shift-start-through-batch-1
handler run renders descriptions correctly in the checklist message.

Also fixed, same session: an employee re-announcing "на месте" later in
the day (after already confirming a shift) was being asked "in which
store are you working today?" again, even though `ShiftLog` already had
the answer — `app/handlers/shift.py::handle_text` now checks
`get_todays_shift` first and just replies that the shift's already
confirmed, without re-resolving the store.

Owner's `question` (not yet resolved): whether "Проверить кассу/POS"
should keep requiring a comment. Reasoning given back to the owner:
a comment there is useful because a POS check can silently fail (wrong
till count, register not opening, printer jam) in ways a bare tap of "done"
wouldn't surface — same logic as the other cash/accounting tasks. Left as
a checkbox-only vs. comment-required decision for the owner to make;
no code changed for that specific task pending their answer.

---

## Decision 27

Date: 2026-07-14

Decision:

Two fixes to the AI question-answering flow (`app/services/ai.py`,
`app/handlers/shift.py`):

1. Every fallback reply told the employee "I'll check with the owner and
   get back to you" (`FALLBACK_NO_KEY`/`FALLBACK_EMPTY_KB`/`FALLBACK_ERROR`)
   but never actually messaged the owner — it was a promise the bot never
   kept. `_try_handle_question_reply` now actually notifies the owner
   (employee name + their question) whenever the answer is one of those
   three fallbacks, same escalation pattern as the reminder engine's
   unresponsive-employee notice.
2. Loosened `SYSTEM_PROMPT`: general/meta questions ("what can you do",
   small talk) are now answered freely and conversationally — the
   knowledge-base-only, never-invent restriction still applies, but only
   to factual questions about the shop/product/instructions, which was
   the actual point of that rule (docs/03_AI_BRAIN.md §13). Previously
   every question was forced through the knowledge-base lens, so a
   question like "ты сам себя настроить можешь?" got an oddly stiff,
   self-describing reply instead of a normal answer.

Also added `include_debug` to `answer_employee_question`: when the owner
is the one asking and the AI call actually throws, the fallback message
now includes the exception type/message. The owner has no Render log
access, so a bare "couldn't find an answer" gave no way to tell a real
API/billing problem apart from a code bug without another round-trip.

Reason:

Owner reported the bot claiming it would "check with the owner" without
ever actually doing so, and separately found it answering meta/self
questions in a strangely robotic, knowledge-base-bound way and then
erroring on a follow-up with no diagnosable detail.

Impact:

Verified against a real local Postgres + constructed aiogram
Message/Update objects (network stubbed at the session level): a
knowledge-base miss now sends a second message to `OWNER_TELEGRAM_ID`
with the employee's name and question. Full test suite (32) still
passes.

---

## Decision 28

Date: 2026-07-14

Decision:

Four fixes/features in one session, all owner-reported:

1. **Purchase-detection false positive.** Decision 26's broadened
   trigger phrases used the stem `"остал"` (to catch
   осталось/осталась/остались/остался), which also matches inside
   unrelated words like "остальные" ("the other ones") — this created a
   purchase request out of an ordinary sentence. Rewrote
   `app/services/purchasing.py` to match whole words only via a compiled
   `\b(...)\b` regex, dropped the overly generic `"мало "` trigger
   entirely, and confirmation messages now say what was actually added
   (`"Добавил в список закупки: {product} 👍"`) instead of a contentless
   "Добавил 👍" — so a legitimate hit is at least identifiable after the
   fact.
2. **Per-batch owner reports.** Owner wants a live update the moment each
   task batch closes, per store/employee — not only the end-of-day
   report. `tasks.py::advance_to_next_batch` now returns
   `(completed_batch, revealed_batch)` instead of just the revealed
   batch; `app/services/reports.py::notify_owner_batch_progress` sends
   the owner a short message (employee, store, batch number, task
   titles) whenever a batch is fully closed, wired into both call sites
   (`handlers/shift.py` and `handlers/tasks.py`).
3. **`ThinkingBlock` crash.** Every AI Processing Layer call
   (`ai.py::answer_employee_question`, `ai.py::chat_reply`,
   `vision.py::verify_photo`) assumed `response.content[0]` was the text
   block and did `.text` on it directly — with extended thinking enabled,
   `content[0]` can be a `ThinkingBlock` with no `.text` attribute, which
   crashed every single call with `AttributeError` (visible to the owner
   via the Decision 27 debug-detail addition). Added `_extract_text()` in
   both modules: scans `response.content` for the first block with
   `type == "text"` instead of assuming position.

Reason:

All four were owner-reported: a confusing unexplained purchase
confirmation (turned out to be the false-positive trigger), a request for
faster/more granular visibility into the day's progress instead of
waiting for the evening report, and the debug detail added in Decision
27 immediately paid off by surfacing the exact `ThinkingBlock` crash the
owner was hitting on every single AI question.

Impact:

Verified against a real local Postgres: a simulated shift + full batch-1
completion produces exactly the expected owner notification with the
right store/employee/task list, and the next batch is still revealed
correctly afterward. Full test suite (32) passes; added dedicated
purchasing tests for the running-low phrasing and confirmed
`"остальные"`-style false positives no longer match.

Open item raised by the owner, not yet built: recognizing purchase
requests from a dedicated "какой чай привезти" chat/topic and inferring
the store from whichever employee is on shift that day, without needing
the message to name the store explicitly — needs a decision on whether
that's a Telegram forum topic (message_thread_id) or a separate chat
before implementing.

---

## Decision 29

Date: 2026-07-14

Decision:

Disabled the AI Q&A fallback (`app/services/ai.py::answer_employee_question`)
as a handler call site. `app/handlers/shift.py::_try_handle_question_reply`
no longer calls the AI Processing Layer at all when an employee asks a
question — it replies with a fixed line ("Хороший вопрос! Уточню у
владельца и вернусь с ответом.") and escalates straight to the owner
(reusing the Decision 27 escalation path), with no Claude call in between.
The mood-check acknowledgement (`chat_reply`, one line after "как
настроение сегодня?") is unaffected — the owner's request was about
open-ended question answering, not the greeting exchange.

Reason:

Owner's stated scope: "его задача понять кто на смене и где и после этого
давать и проверять задания. больше пока ничего" (its job is to figure out
who's on shift and where, then assign and check tasks — nothing else for
now). The immediate trigger was the `ThinkingBlock` crash (Decision 28)
recurring on ordinary questions, but the owner's ask was broader than
"fix the crash" — scale the bot back to the core loop until this feature
is wanted again.

Impact:

`answer_employee_question`/`FALLBACK_*`/knowledge-base wiring stay in
`app/services/ai.py` (untouched, still unit-tested) so re-enabling Q&A
later is a one-line change at the single call site, not a rebuild.
Verified against a real local Postgres + constructed aiogram
Message/Update: a question now produces exactly two messages (the fixed
employee reply, the owner escalation) and zero AI Processing Layer calls.
Full test suite still passes.

---

## Decision 30

Date: 2026-07-14

Decision:

Added `app/handlers/tea_requests.py`: a dedicated "какой чай привезти"
chat/topic where every message is treated as a tea-restock request
outright — no trigger-phrase detection like `purchasing.py`, since
writing there already means "bring this tea". The store is inferred from
whichever store the sender is on shift at *today* (`ShiftLog`), not from
the message text, per owner's exact ask ("бот автоматически понимает в
какой магазин" from who's on shift where). Configured via two new
optional settings, `TEA_REQUEST_CHAT_ID` and `TEA_REQUEST_THREAD_ID`
(`app/config.py`, `.env.example`) — the feature is a no-op until
`TEA_REQUEST_CHAT_ID` is set. `TEA_REQUEST_THREAD_ID` is only needed if
it's a forum topic inside the existing group (not its own chat).
Registered in `app/bot.py` before `shift.py`'s generic catch-all so a
match here never falls through to shift-start/task-reply detection meant
for the main work chat.

Reason:

Owner wants tea restock requests to come from a dedicated topic instead
of being detected by keyword inside the general work chat, with the
store inferred automatically the same way the rest of the bot already
knows who's where.

Impact:

Verified against a real local Postgres + constructed aiogram objects: a
message in the configured topic creates a `PurchaseRequest` scoped to the
sender's today-shift store; the exact same chat with a *different*
thread ID falls through untouched (no request created). New unit tests
for the chat/topic matching logic. Full test suite (36) passes.

**Owner needs to provide the actual IDs to turn this on** — I can't
guess them:
1. If it's a topic inside the existing work group: open Telegram, go
   into that topic, and check the URL when you tap a message/share it —
   it'll look like `https://t.me/c/XXXXXXXXXX/YYY` where the group's
   `chat_id` is `-100XXXXXXXXXX` and the topic's `message_thread_id` is
   `YYY`.
2. If it's a separate chat entirely, just its `chat_id` is enough (leave
   `TEA_REQUEST_THREAD_ID` empty) — forward any message from that chat to
   @userinfobot or @RawDataBot to get the numeric ID.

---

## Decision 31

Date: 2026-07-14

Decision:

`_try_handle_question_reply` (Decision 29's escalation-only path) now
only runs for messages sent in a private chat with the bot —
`message.chat.type == "private"`. In the group chat it no longer reacts
to question-shaped text at all.

Reason:

Owner wrote "Вам там бот пишет?" to employees in the group chat — a
question aimed at the *employees*, not the bot — and it got escalated to
the owner as if an employee had asked the bot something. The group chat
is where the owner and employees talk to each other; a trailing "?" there
doesn't mean the message is addressed to the bot the way it reasonably
would in a 1:1 DM with it, where there's no one else it could be talking
to.

Impact:

Verified against a real local Postgres + constructed aiogram objects: the
exact same question text now produces zero messages when sent in a group
chat, and still escalates correctly when sent in a private chat. Full
test suite (36) passes.

---

## Decision 32

Date: 2026-07-14

Decision:

Replaced `purchasing.py`'s whole keyword list (закончился/осталось/нет/
докупить/привезти/...) with a single unambiguous trigger phrase: "нужно
привезти". Tea restock requests are handled entirely by the dedicated
topic (`app/handlers/tea_requests.py`, Decision 30) — this module now
only covers everything else in the main work chat (packaging, napkins,
milk, etc.).

Reason:

Owner's explicit scope: question-shaped sentences never concern the bot;
the bot only cares about private dialogs with employees and the first
morning shift-start message — and for purchases specifically, drop
keyword-phrase guessing in favor of the dedicated tea topic plus one
clear phrase for everything else, instead of a growing list of fuzzy
triggers that kept producing false positives (Decision 28's "остальные"
bug being the clearest example).

Impact:

`extract_product`'s position-aware logic (trigger leads vs. trigger
follows) is unchanged and still handles both "Нужно привезти сахар" and
"Сахар нужно привезти". Test suite rewritten for the single-phrase
behavior (34 tests, all passing) — old tests for
закончился/осталось/докупить wording were removed since that wording no
longer triggers a purchase request in this module (tea-specific phrasing
still works via the dedicated topic).

---

## Decision 33

Date: 2026-07-14

Decision:

The tea-request topic (`app/handlers/tea_requests.py`, Decision 30) no
longer treats every message as a request. It now requires the message to
contain at least one 4- or 8-digit product article code (`\b\d{4}\b` or
`\b\d{8}\b`, matched via `(?<!\d)\d{4}(?!\d)|(?<!\d)\d{8}(?!\d)` so a
longer/shorter digit run doesn't accidentally qualify) — matching the
owner's actual order-list format, e.g.:

```
В Черемушки нужен чай:
3005 тг
3101 дхп
...
6242 9978 2023 г
```

Without a matching code, the message is left alone (falls through
untouched, same as before this topic existed).

Reason:

The topic can carry casual chatter too, not only order lists — treating
literally every message as a purchase request would create bogus
`PurchaseRequest` rows for things like "привет всем".

Impact:

Verified against a real local Postgres with the owner's own example
message (multi-line list mixing 4-digit codes and an 8-digit one):
creates exactly one `PurchaseRequest` scoped to the sender's today-shift
store, with the whole message as the product text; a casual message with
no digit codes in the same topic produces no request and no reply. New
unit tests for the code-length boundary (3/5-digit runs don't count,
4/8-digit do). Full test suite (36) passes.

---

## Decision 34

Date: 2026-07-14

Decision:

Two fixes:

1. **Reverted the "no AI at all" part of Decision 29.** Owner's stated
   need flipped from "nothing but shift/tasks" to "the bot should be able
   to hold a conversation and answer" after seeing an employee's "что
   умеет бот" get a flat escalation instead of an answer. Private-chat
   questions now go through `answer_employee_question` again (the
   loosened, general-conversation-friendly system prompt from Decisions
   27/28, with the `ThinkingBlock` crash already fixed) — only actually
   unanswerable factual questions (empty knowledge base, no API key, a
   real error) still escalate to the owner. Decision 31's group-chat
   restriction is unchanged: a question typed in the group is still never
   treated as addressed to the bot.
2. **Fixed a stuck-shift dead end.** An employee re-announcing "на
   месте" got "Смена уже отмечена" and nothing else, forever — because
   `ShiftLog` existing was treated as proof the whole flow (mood-check +
   task creation) had completed, but that flow's FSM state lives in
   `MemoryStorage` and doesn't survive a process restart (which happens
   on every Render redeploy). If the employee's shift got recorded but
   the process restarted before they answered "как настроение", they'd
   be stuck: shift confirmed, no tasks, every future "на месте" a no-op.
   Added `tasks.py::has_tasks_for_today`; `handle_text` now checks it and
   resumes via `_confirm_shift` (re-asks mood, then creates tasks) instead
   of just repeating "already confirmed" when no tasks exist yet.

Reason:

Both owner-reported: an employee's meta question got an unhelpfully
mechanical escalation instead of a real answer, and a real employee
(Вазген) got permanently stuck after a redeploy landed mid-shift-start.

Impact:

Verified against a real local Postgres + constructed aiogram objects: a
`ShiftLog` with zero `Task` rows now re-triggers the mood-check greeting
on the next "на месте" instead of a dead-end reply; a private-chat
question goes through the AI layer again while the same question in the
group chat is still ignored. Full test suite (36) passes.

---

# Current Next Steps

1. Finish deploying to Render (Postgres + Web Service created this
   session) and confirm the bot responds in Telegram end-to-end: shift
   start, task checklist/completion, reminders, purchase requests, revenue
   report, and a knowledge-base question.

2. Replace the placeholder knowledge-base entries with real WAYSTEA
   instructions, and consider replacing the keyword heuristics in
   purchasing/upsell detection with proper LLM-based entity extraction now
   that the AI Processing Layer exists.

3. Build the Learning/Reflection Engine (docs/03_AI_BRAIN.md §8-10) for
   cross-day pattern detection — the one piece of docs/03_AI_BRAIN.md not
   yet covered.

---

# Notes

This document should be updated throughout the project lifecycle.
