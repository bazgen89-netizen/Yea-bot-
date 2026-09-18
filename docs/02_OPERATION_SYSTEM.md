# WAYSTEA ONE
# Operation System Specification

Version: 1.0

---

# 1. Purpose

This document describes the operational logic of WAYSTEA ONE.

WAYSTEA ONE manages daily operations of WAYSTEA tea stores.

The main objective:

Create a system where employees clearly understand what needs to be done, while the owner receives only important information.

---

# 2. System Users

## Owner

The owner manages the company and controls the AI system.

Owner capabilities:

- create tasks;
- edit standards;
- view reports;
- receive alerts;
- approve important decisions;
- update company knowledge.

---

## Employee

Employee uses WAYSTEA ONE through Telegram.

Employee capabilities:

- confirm shift start;
- receive tasks;
- complete tasks;
- send photos;
- write comments;
- report problems;
- request help.

---

## AI Operations Manager

WAYSTEA ONE performs the role of digital manager.

Responsibilities:

- monitor operations;
- communicate with employees;
- track execution;
- store knowledge;
- analyze situations.

---

# 3. Store Structure

The system must support multiple stores.

Example:

- Cheremushki
- Gagarina
- Rynok

Each store has:

- employees;
- schedule;
- tasks;
- history;
- operational statistics.

---

# 4. Shift Management

## Opening Time

All stores open at:

10:00

---

# Shift Start Process

Employee writes in Telegram:

Examples:

"Черёмушки на месте"

"Гагарина я на месте"

"Я пришёл"

"Я на смене"

---

The AI identifies:

- employee;
- store;
- date;
- time.

Creates event:

SHIFT_STARTED

---

AI response example:

"Доброе утро 😊
Смена открыта.
Сейчас отправлю задачи на сегодня."

---

# 5. Missing Shift Confirmation

The system checks scheduled employees.

If employee did not confirm arrival:

After opening time:

AI asks in general chat:

"Коллеги, кто сегодня на смене?
Не вижу отметки от всех сотрудников 😊"

---

After 15-30 minutes:

AI sends personal message:

"Доброе утро!
Не вижу подтверждения начала смены.
Всё в порядке?"

---

If there is no response:

Owner receives notification:

"Employee did not confirm shift start.
Reminders were sent."

---

# 6. Task Management System

Tasks can be created by:

1. Owner

2. Daily templates

3. AI automatically

---

# Task Types

## Daily Tasks

Examples:

- check workplace;
- clean equipment;
- check display;
- check tea availability.

---

## One-Time Tasks

Examples:

- prepare event;
- update decoration;
- organize inventory.

---

## Control Tasks

Require confirmation:

- photo;
- comment;
- quantity.

---

## Emergency Tasks

Examples:

- equipment failure;
- customer problem;
- missing important product.

---

# 7. Task Structure

Each task contains:

- title;
- description;
- store;
- employee;
- creation time;
- deadline;
- priority;
- completion requirements.

---

# 8. Task Statuses

Created

↓

Received

↓

In Progress

↓

Waiting Confirmation

↓

Completed

↓

Archived

---

# 9. Task Completion

Employee can complete task by:

- clicking button;
- writing "готово";
- writing natural language.

The AI understands message meaning.

---

Example:

Employee:

"готово"

AI checks active tasks.

---

If task does not require confirmation:

Task moves to:

Completed.

---

If confirmation is required:

AI asks:

"Отлично 👍
Добавь, пожалуйста, комментарий."

or:

"Пришли фото результата."

---

# 10. Reminder System

If task is not completed:

## First reminder

After 30 minutes:

"Напоминаю про задачу 😊
Когда будет возможность, отметь выполнение."

---

## Second reminder

After 60 minutes:

"Задача ещё не закрыта.
Есть сложности? Нужна помощь?"

---

## Owner notification

If employee ignores reminders:

Owner receives:

- employee name;
- task;
- delay time;
- reminder history.

---

# 11. Purchasing System

Employees can report missing products.

Examples:

"Закончился ГАБА"

"Нет чайных пакетов"

"Закончились стаканы"

---

AI understands:

- product;
- store;
- date.

Creates purchase request.

---

Example:

Product:
GABA Alishan

Store:
Gagarina

Status:
Waiting purchase

---

AI response:

"Добавил в список закупки 👍"

---

# 12. Purchasing Intelligence

The AI analyzes purchasing history.

Examples:

"The product GABA Alishan runs out faster than usual."

"Consider increasing stock level."

---

# 13. Shift Closing

Before closing time AI sends checklist.

Example:

Closing checklist:

☐ Clean workplace

☐ Wash teaware

☐ Check remaining tea

☐ Check equipment

☐ Prepare store for next shift

---

After completion:

AI confirms:

"Смена закрыта.
Спасибо за работу 😊"

---

# 14. Employee Questions

Employees can ask questions naturally.

Examples:

"Как заваривать этот чай?"

"Что делать если клиент недоволен?"

"Где инструкция?"

---

AI answers using:

1. Company knowledge base

2. Previous decisions

3. Approved instructions

---

# 15. Daily Owner Report

Every day AI generates report.

Example:

WAYSTEA ONE Daily Report

Date:

---

Stores:

All stores opened on time.

---

Tasks:

Completed:
95%

Incomplete:
5%

---

Purchases:

5 items added.

---

Problems:

2 operational issues.

---

AI Recommendations:

- update instruction;
- check equipment;
- improve process.

---

# 16. Operational Philosophy

The system should reduce owner's routine work.

AI should solve simple operational issues independently.

AI should involve the owner only when human judgment is required.

---

# Final Principle

Employees should work with clarity.

Owner should manage with visibility.

WAYSTEA ONE should become the operational nervous system of the company.
