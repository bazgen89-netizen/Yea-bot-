# WAYSTEA ONE
# Technical Specification

Version: 1.0

---

# 1. Purpose

This document defines the technical requirements for building WAYSTEA ONE.

WAYSTEA ONE should be developed as a scalable AI-powered operational management system.

The first interface is Telegram, but the architecture must allow future expansion.

---

# 2. Development Philosophy

The system should be:

- scalable;
- maintainable;
- secure;
- modular;
- easy to improve.

The project should not be created as a simple Telegram script.

The architecture must support future AI modules.

---

# 3. System Architecture

General architecture:

> Source document was cut off at this point. The architecture, data model, tech stack,
> and infrastructure details below were established during the planning conversation
> with Claude and should be treated as the working continuation of this section
> until the original author extends this file further.

## 3.1 Modules

- Telegram Gateway — webhook intake, message routing, outbound replies/photos.
- AI Processing Layer — single entry point to the LLM; intent classification and
  entity extraction (store name, product, quantity) from natural language.
- Identity/Employee Module — maps Telegram user_id to an employee record; runs the
  name-confirmation onboarding flow for first-time senders.
- Shift Engine — parses the daily "on site" message, resolves which store the
  employee is working at today (store assignment is per-day, not fixed).
- Task Engine — daily/one-time/control/emergency tasks, status lifecycle, natural
  language completion detection.
- Reminder/Notification Engine — delayed reminders (30 / 60 min) and owner escalation.
- Purchasing Module — turns "product is out" messages into purchase requests.
- Sales/Revenue Module — end-of-shift revenue entry and upsell tracking (see
  09_KPI_AND_REVENUE_MODULE.md).
- Reporting Module — daily/weekly report assembly for the owner.
- Memory Service — a single abstraction over the five memory types defined in
  03_AI_BRAIN.md, backed by one database with logically separated tables.

## 3.2 Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend | Python + FastAPI | mature LLM tooling, async, easy to extend module by module |
| Telegram | aiogram (async) | webhook support, FSM for clarifying-question dialogs |
| LLM | Claude API | natural language understanding, entity extraction, knowledge-base Q&A |
| Database | PostgreSQL | reliable, JSONB for flexible fields, pgvector-ready for future semantic search |
| Scheduling | Redis + APScheduler | delayed reminders, daily report jobs |
| Hosting (MVP) | single VPS, Docker Compose | traffic from 3 stores does not justify more |

## 3.3 Data Model (core entities)

- `Employee` (id, telegram_id, name, created_at)
- `Store` (id, name, aliases[])
- `ShiftLog` (employee_id, store_id, date, confirmed_at)
- `Task` / `TaskTemplate` (store_id, employee_id, status, requires_proof, proof_type)
- `PurchaseRequest` (store_id, employee_id, product, status, created_at)
- `ShiftRevenue` (employee_id, store_id, date, total, cash, non_cash)
- `UpsellEvent` (employee_id, store_id, timestamp, type, product, amount)
- `MemoryEntry` (type: store/employee/owner/company, key, value)
- `DailyReport` (date, content)

## 3.4 Known Constraints

- No POS integration: the store cash register (CloudShop) has a closed API. Revenue
  and upsell data are entered manually by the employee at shift closing and cannot be
  cross-validated against register data. Treat these numbers as self-reported.
- Single owner account, no role hierarchy for MVP.
- Russian is the primary operating language for all employee-facing communication.

---

# 4. Security & Operations (to be expanded)

Not yet specified in the source document. Placeholder for: authentication/access
control for the owner-facing surface, PII handling for employee data and photos,
backup strategy, and logging/monitoring — needed before production rollout, not
blocking MVP development.
