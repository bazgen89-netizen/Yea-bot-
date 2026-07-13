# WAYSTEA ONE
# MVP Requirements

Version: 1.0

---

# 1. MVP Goal

The goal of the first version of WAYSTEA ONE:

Create a working AI digital employee that removes routine operational control from the owner.

The first version must solve the main daily problems:

- employee attendance;
- task control;
- reminders;
- purchasing collection;
- daily reporting.

---

# 2. MVP Philosophy

Build a simple but reliable system.

Priority:

1. Working processes.

2. Stable operation.

3. Employee adoption.

4. Data collection.

5. Future expansion.

---

# 3. MVP Interface

Primary interface:

Telegram.

Reason:

- employees already use Telegram;
- no additional application required;
- fast implementation.

---

# 4. MVP Users

## Owner

Can:

- create tasks;
- view reports;
- receive alerts;
- manage standards.

---

## Employee

Can:

- confirm shift;
- receive tasks;
- complete tasks;
- send comments;
- report problems.

---

# 5. MVP Feature 1
# Shift Control

System must:

- identify employee;
- identify store;
- record arrival time.

Examples:

Employee writes:

"Гагарина на месте"

System understands:

Employee:
(name)

Store:
Gagarina

Time:
(current time)

Creates:

SHIFT_STARTED

---

# 6. MVP Feature 2
# Daily Tasks

System sends daily tasks.

Example:

Morning checklist:

☐ Check workplace

☐ Check tea availability

☐ Prepare equipment

☐ Check cleanliness

---

Employee can:

- click complete;
- write "готово".

---

# 7. MVP Feature 3
# Task Verification

Some tasks require proof.

Examples:

Cleaning:

Requires photo.

Inventory:

Requires comment.

Tea preparation:

Requires confirmation.

---

AI asks:

"Отправь фото результата."

or:

"Напиши количество."

---

# 8. MVP Feature 4
# Reminder System

If task is incomplete:

After 30 minutes:

Friendly reminder.

---

After 60 minutes:

Second reminder.

---

If ignored:

Notify owner.

---

# 9. MVP Feature 5
# Purchase List

Employees can write:

"Закончился чай"

"Нет стаканов"

"Нужны пакеты"

---

AI creates:

Purchase item:

- product;
- store;
- employee;
- date.

---

# 10. MVP Feature 6
# Daily Owner Report

Every day owner receives:

## Attendance

Who started shift.

---

## Tasks

Completed:

%

Incomplete:

%

---

## Problems

List of important issues.

---

## Purchases

Items requiring attention.

---

# 11. MVP Memory

The first version must include basic memory.

Required memory:

- employees;
- stores;
- tasks history;
- owner decisions.

---

# 12. MVP Does NOT Include Yet

Do not build initially:

- mobile application;
- advanced analytics dashboard;
- voice assistant;
- automatic employee scoring;
- full inventory prediction;
- marketing automation.

These belong to future versions.

---

# 13. MVP Success Criteria

The first version is successful when:

1. Employees automatically report arrival.

2. Employees receive daily tasks.

3. Owner sees execution status.

4. Purchase requests are collected automatically.

5. Owner spends less time controlling routine operations.

Quantified targets and measurement method for these criteria are defined in
09_KPI_AND_REVENUE_MODULE.md.

---

# 14. Development Priority

Build in this order:

1. Telegram connection.

2. User identification.

3. Store management.

4. Shift system.

5. Task system.

6. Reminders.

7. Purchase system.

8. Reports.

9. Memory improvement.

10. Sales/revenue module (end-of-shift revenue entry, upsell tracking).

---

# Final MVP Principle

Do not build the biggest AI system.

Build the smallest useful digital employee.

The system should work every day and create real business value.
