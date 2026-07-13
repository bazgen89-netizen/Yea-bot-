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

    employee: Mapped["Employee"] = relationship()
    store: Mapped["Store"] = relationship()


class TaskTemplate(Base):
    """A recurring daily task. `store_id` NULL means it applies to every store."""

    __tablename__ = "task_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    requires_proof: Mapped[bool] = mapped_column(Boolean, default=False)
    proof_type: Mapped[str] = mapped_column(String(20), default=ProofType.NONE.value)
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
    requires_proof: Mapped[bool] = mapped_column(Boolean, default=False)
    proof_type: Mapped[str] = mapped_column(String(20), default=ProofType.NONE.value)
    status: Mapped[str] = mapped_column(String(20), default=TaskStatus.CREATED.value)

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
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
