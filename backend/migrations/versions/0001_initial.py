"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 首次启动仍可用 SQLModel create_all；本迁移标记为基线，
    # 后续增量变更走 alembic revision --autogenerate
    pass


def downgrade() -> None:
    pass
