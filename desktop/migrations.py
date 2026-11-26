"""Programmatic Alembic migration runner for desktop mode."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from desktop.paths import AppPaths

logger = logging.getLogger("desktop.migrations")


def run_migrations(paths: AppPaths, database_url: str) -> None:
    """Run `alembic upgrade head` against the embedded PostgreSQL instance."""
    backend_str = str(paths.backend_dir)
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)

    if not paths.alembic_dir.is_dir():
        raise FileNotFoundError(f"Alembic scripts directory not found: {paths.alembic_dir}")

    alembic_cfg = Config()
    alembic_cfg.set_main_option("script_location", str(paths.alembic_dir))
    alembic_cfg.set_main_option("sqlalchemy.url", database_url)

    logger.info("Applying Alembic migrations from %s ...", paths.alembic_dir)
    command.upgrade(alembic_cfg, "head")
    logger.info("Database migrations are up to date.")
