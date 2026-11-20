from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from fastapi import HTTPException, status
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

pool = ConnectionPool(
    conninfo=settings.database_url,
    min_size=1,
    max_size=10,
    open=False,
    kwargs={
        "row_factory": dict_row,
        "autocommit": False,
    },
)


def init_pool() -> None:
    if pool.closed:
        raise RuntimeError("Database connection pool has already been closed.")
    pool.open(wait=True, timeout=10.0)


def close_pool() -> None:
    pool.close()


def get_db() -> Iterator[Connection[dict[str, Any]]]:
    try:
        with pool.connection(timeout=10.0) as conn:
            yield conn
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection unavailable: {exc}",
        ) from exc


def check_database_health() -> bool:
    try:
        with pool.connection(timeout=3.0) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                row = cur.fetchone()
                return bool(row and row.get("ok") == 1)
    except Exception:
        return False
