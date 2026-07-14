import datetime
import enum

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class ProofType(str, enum.Enum):
    NONE = "none"
    PHOTO = "photo"
    COMMENT = "comment"


class TaskStatus(str, enum.Enum):
    """Collapses docs/02_OPERATION_SYSTEM.md §8's Created/Received/In
    Progress into CREATED for MVP — the employee acts on a task the moment
    they see it, there's no separate "received" acknowledgement step yet.
    """

    CREATED = "created"
    WAITING_PROOF = "waiting_proof"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class PurchaseStatus(str, enum.Enum):
    WAITING_PURCHASE = "waiting_purchase"
    PURCHASED = "purchased"


class UpsellType(str, enum.Enum):
    """docs/09_KPI_AND_REVENUE_MODULE.md §3.2."""

    EXTRA_TEA = "extra_tea"
    PAIRING = "pairing"
    TASTING_TO_PURCHASE = "tasting_to_purchase"


class Base(DeclarativeBase):
    pass


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    aliases: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ShiftLog(Base):
    __tablename__ = "shift_logs"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_employee_shift_per_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    date: Mapped[datetime.date] = mapped_column(Date)
    confirmed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    upsell_nudge_sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # docs decision: ask about music a couple of times per shift — not a
    # single nudge like upsell. See app/services/music.py.
    music_nudges_sent: Mapped[int] = mapped_column(default=0)
    last_music_nudge_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class PurchaseRequest(Base):
    """Feature 5 (docs/08_MVP_REQUIREMENTS.md §9): Purchase List."""

    __tablename__ = "purchase_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    product: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(
        String(20), default=PurchaseStatus.WAITING_PURCHASE.value
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class ShiftRevenue(Base):
    """docs/09_KPI_AND_REVENUE_MODULE.md §3.1 — self-reported, no POS."""

    __tablename__ = "shift_revenues"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_employee_revenue_per_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    date: Mapped[datetime.date] = mapped_column(Date)
    total: Mapped[int] = mapped_column()
    cash: Mapped[int] = mapped_column()
    non_cash: Mapped[int] = mapped_column()
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class UpsellEvent(Base):
    """docs/09_KPI_AND_REVENUE_MODULE.md §3.2."""

    __tablename__ = "upsell_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    upsell_type: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class MusicCheck(Base):
    """Owner request: ask a couple times per shift what's playing and
    whether the volume is right; each reply is logged here and rolled into
    the daily owner report (app/services/reports.py).
    """

    __tablename__ = "music_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    note: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class KnowledgeEntry(Base):
    """Company Memory (docs/03_AI_BRAIN.md §6.5): standards, instructions,
    tea knowledge. Small enough for MVP scale to pass in full as LLM
    context rather than needing real retrieval/embeddings.
    """

    __tablename__ = "knowledge_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(String(2000))


class TaskTemplate(Base):
    """A recurring daily task. `store_id` NULL means it applies to every store."""

    __tablename__ = "task_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    # Shown alongside the title in the checklist message — the detailed
    # instructions for what "done" actually means (e.g. which specific
    # things to check), since the title alone is just a short label.
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requires_proof: Mapped[bool] = mapped_column(Boolean, default=False)
    proof_type: Mapped[str] = mapped_column(String(20), default=ProofType.NONE.value)
    # Only meaningful when proof_type == PHOTO: what the AI vision check
    # (app/services/vision.py) should look for before accepting the photo.
    verification_criteria: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Tasks are revealed a batch at a time (docs decision: 3 simplest first,
    # then batches of ~3-5), not all at once — lower batch = shown sooner.
    # See app/services/tasks.py::advance_to_next_batch.
    batch: Mapped[int] = mapped_column(default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Task(Base):
    """A concrete task instance assigned to one employee on one day."""

    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "template_id", "date", name="uq_employee_template_per_day"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("task_templates.id"), nullable=True
    )
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    date: Mapped[datetime.date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requires_proof: Mapped[bool] = mapped_column(Boolean, default=False)
    proof_type: Mapped[str] = mapped_column(String(20), default=ProofType.NONE.value)
    verification_criteria: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=TaskStatus.CREATED.value)
    # The comment an employee left when closing a COMMENT-proof task — shown
    # to the owner alongside the task title (app/services/reports.py), not
    # just discarded once the task is marked done.
    proof_comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    batch: Mapped[int] = mapped_column(default=1)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # NULL until this task's batch has actually been revealed to the
    # employee. Reminders (app/services/reminders.py) count the 30/60-minute
    # window from here, not from created_at — a task sitting unseen in a
    # later batch shouldn't start "aging" before the employee even knows
    # about it.
    sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    first_reminder_sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    second_reminder_sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    owner_notified_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()
