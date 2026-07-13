# WAYSTEA ONE
# KPI, MVP Success Criteria & Sales/Revenue Module

Version: 1.0

---

# 1. Purpose

This document defines two things that were missing from the original
documentation set:

1. Quantified success criteria for the MVP (01_PRODUCT_VISION.md §11 and
   08_MVP_REQUIREMENTS.md §13 stated success qualitatively only).
2. A revenue-growth module: the owner's current priority is increasing
   revenue, which is low today. This module defines how the AI collects
   revenue-related data and which employee behaviors it monitors, without
   violating the AI safety rules already defined in 03_AI_BRAIN.md and
   01_PRODUCT_VISION.md (the AI does not evaluate or judge employees on its
   own authority — see §6 below).

---

# 2. Operational MVP KPIs

These track whether the core MVP (shift/task/purchasing/reporting) is
working as intended.

| Metric | Target |
|---|---|
| % shifts confirmed by the employee without manual owner intervention | ≥ 90% |
| % daily tasks closed on time, per store | ≥ 85% |
| Average time from task overdue to owner escalation | ≤ 60 min (per 02_OPERATION_SYSTEM.md §10) |
| % purchase requests captured automatically (no manual owner entry) | ≥ 95% |
| Daily report delivered to owner without failure | 100% of days |
| Owner manual interventions in routine operations per week (baseline vs. after MVP) | ≥ 50% reduction after 4 weeks |
| % employee messages understood by AI without a clarifying question | ≥ 80% |

---

# 3. Revenue Data Collection

There is no POS integration (CloudShop's API is closed — see
04_TECH_SPEC.md §3.4). All revenue data is self-reported by the employee
through the chat and cannot be cross-validated automatically. This is a
known data-quality limitation, not a defect to be engineered away in MVP.

## 3.1 End-of-shift revenue entry

At shift closing (02_OPERATION_SYSTEM.md §13 checklist), the AI adds three
required fields before the shift can be marked closed:

- Total revenue for the shift
- Cash portion
- Non-cash (card/transfer) portion

Stored as `ShiftRevenue` (employee_id, store_id, date, total, cash, non_cash).

## 3.2 Upsell events

Employees log upsell activity during the day, either through natural
language ("предложил дегустацию Да Хун Пао, купили 100г") parsed by the AI,
or a short guided prompt if they ask to log one. Tracked event types:

- Extra tea sold in addition to the main purchase (доп. чай)
- Pairing / snack items sold alongside tea (вкусности к чаю)
- Tasting-to-purchase: customer tastes a tea while their order is prepared
  and buys that tea

Stored as `UpsellEvent` (employee_id, store_id, timestamp, type, product,
amount).

## 3.3 Proactive nudges (Level 1 — autonomous)

During the shift, the AI may send friendly reminders to encourage upsell
behavior, e.g. "Не забудь предложить дегустацию, пока собираешь заказ 😊".
This is a Decision Engine Level 1 action (03_AI_BRAIN.md §4) — no owner
approval needed, same category as existing task reminders.

---

# 4. Revenue & Upsell KPIs

| Metric | Purpose |
|---|---|
| Revenue by store, day/week/month trend | primary growth indicator |
| Cash vs. non-cash split | operational visibility for the owner |
| Upsell events per shift (count) | leading indicator, tracked per store |
| Tasting-to-purchase conversion (tastings offered vs. tea bought) | measures effectiveness of the tasting-while-packing technique |
| Week-over-week revenue growth, per store | the concrete answer to "is revenue growing" |

These are collected and aggregated automatically; none of them are used by
the AI to independently score or rank employees.

---

# 5. Reporting

## 5.1 To the employee (in the moment)

Friendly nudges only ("не забудь предложить..."). No scores, no comparisons
to other employees, no negative framing — consistent with
01_PRODUCT_VISION.md §7 (communication style) and §5 (not a punishment tool).

## 5.2 To the owner (daily / on request)

The daily report (02_OPERATION_SYSTEM.md §15) gains a Sales section:

- Revenue per store (total, cash, non-cash)
- Upsell counts per store and, if requested, per employee
- Tasting-to-purchase conversion
- Any employee-level rating or comparison — sent to the owner only, never
  surfaced to employees, and framed as information for the owner's own
  judgment, not as an automatic verdict from the AI

---

# 6. Why ratings stay owner-only

01_PRODUCT_VISION.md §8 and 03_AI_BRAIN.md §14 both state the AI must not
make personnel/evaluation decisions and must not become a "surveillance
system" or "punishment tool" for employees. Tracking upsell/revenue data and
reporting it to the owner is a Level 1/2 action (collect + notify); turning
that data into an employee rating or score is treated as owner's own
analysis, not an autonomous AI decision — the AI supplies the data, the
owner decides what to do with it.

---

# 7. Open Items

- Exact list of "acceptable" employee response variants for revenue entry
  (e.g., is "нал 5000 без 3000" enough, or does the AI need a fixed format?)
  to be refined during Sales/Revenue Module implementation.
- Whether the owner wants a weekly digest in addition to the daily report,
  specifically for the revenue trend line.
