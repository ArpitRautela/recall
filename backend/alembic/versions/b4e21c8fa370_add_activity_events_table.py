"""add activity_events table

Revision ID: b4e21c8fa370
Revises: 753194b50b96
Create Date: 2026-09-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4e21c8fa370'
down_revision: Union[str, Sequence[str], None] = '753194b50b96'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'activity_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column(
            'event_type',
            sa.Enum(
                'DOCUMENT_UPLOADED',
                'DOCUMENT_READY',
                'DOCUMENT_FAILED',
                'CONVERSATION_STARTED',
                name='activity_event_type',
            ),
            nullable=False,
        ),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('subtitle', sa.String(length=500), nullable=True),
        sa.Column('document_id', sa.Integer(), nullable=True),
        sa.Column('conversation_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        # SET NULL, not CASCADE: the activity log outlives the thing it describes.
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_activity_events_user_created', 'activity_events', ['user_id', 'created_at'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('activity_events')
