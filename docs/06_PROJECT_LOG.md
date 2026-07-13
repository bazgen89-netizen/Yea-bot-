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

Architecture and MVP scope agreed. Ready to start implementation.

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

# Current Next Steps

1. Scaffold the WAYSTEA ONE project structure (separate from `archive/old_tea_qa_bot/`).

2. Implement modules in the order defined in 08_MVP_REQUIREMENTS.md §14.

---

# Notes

This document should be updated throughout the project lifecycle.
