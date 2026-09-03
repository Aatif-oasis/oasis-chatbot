import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.core.database import Base

# Import every module's models so Base.metadata knows about all tables —
# this list grows by one line per module, mirroring main.py's router list.
from app.modules.organizations.models import Organization  # noqa: F401
from app.modules.departments.models import Department  # noqa: F401
from app.modules.teams.models import Team, user_teams  # noqa: F401
from app.modules.users.models import User  # noqa: F401
from app.modules.roles_permissions.models import (  # noqa: F401
    Permission,
    Role,
    role_permissions,
    user_roles,
)
from app.modules.auth.models import ApiKey, RefreshToken  # noqa: F401
from app.modules.customers.models import Customer  # noqa: F401
from app.modules.conversations.models import Conversation, ConversationNote, Message, Tag, conversation_tags  # noqa: F401
from app.modules.attachments.models import Attachment  # noqa: F401
from app.modules.quick_replies.models import QuickReply  # noqa: F401
from app.modules.tickets.models import Ticket, TicketComment  # noqa: F401
from app.modules.knowledge_base.models import KnowledgeBaseArticle, KnowledgeBaseCategory  # noqa: F401
from app.modules.automation.models import AutomationRule  # noqa: F401
from app.modules.audit_logs.models import AuditLog  # noqa: F401
from app.modules.webhooks.models import WebhookDelivery, WebhookSubscription  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
