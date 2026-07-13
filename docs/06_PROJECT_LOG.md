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
