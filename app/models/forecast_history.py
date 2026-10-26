"""预测快照与后验评估分表追加，避免新分析覆盖当时给出的窗口。"""

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class ForecastSnapshot(Base):
    __tablename__ = "forecast_snapshots"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    created_at: Mapped[str] = mapped_column(Text, index=True)
    account: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(Text)
    policy_version: Mapped[str] = mapped_column(Text)
    payload: Mapped[str] = mapped_column(Text)


class ForecastEvaluation(Base):
    __tablename__ = "forecast_evaluations"
    snapshot_id: Mapped[str] = mapped_column(Text, primary_key=True)
    evaluated_at: Mapped[str] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text)
    evidence_ids: Mapped[str] = mapped_column(Text)
