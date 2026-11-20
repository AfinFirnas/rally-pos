from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from ..database import get_db
from ..schemas import (
    BoothAnalyticsResponse,
    BoothItemEnvelope,
    CreateBoothItemRequest,
    DeleteBoothItemResponse,
    TenantEnvelope,
    TenantItemOut,
    TenantOut,
    TransactionOut,
    UpdateBoothItemRequest,
    UpdateBoothProfileRequest,
)
from ..security import require_booth

router = APIRouter(prefix="/api/booths", tags=["booths"])


def _assert_booth_access(
    conn: Connection[dict[str, Any]],
    tenant_id: str,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM public.tenants WHERE id = %s", (tenant_id,))
        tenant = cur.fetchone()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booth not found.")
    if not current_user.get("is_admin") and str(tenant["user_id"]) != str(current_user["id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage this booth.",
        )
    return tenant


@router.get("/{tenant_id}/analytics", response_model=BoothAnalyticsResponse)
def get_booth_analytics(
    tenant_id: str,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> BoothAnalyticsResponse:
    tenant = _assert_booth_access(conn, tenant_id, current_user)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(actual_amount_idr) FILTER (WHERE status = 'completed'), 0)::BIGINT AS total_sales,
                COUNT(*) FILTER (WHERE status = 'completed')::INT AS completed_cnt,
                COUNT(*) FILTER (WHERE status = 'voided')::INT AS voided_cnt
            FROM public.transactions
            WHERE tenant_id = %s
            """,
            (tenant_id,),
        )
        agg = cur.fetchone()

        cur.execute(
            """
            SELECT * FROM public.transactions
            WHERE tenant_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (tenant_id,),
        )
        recent_txs = cur.fetchall()

    return BoothAnalyticsResponse(
        tenant=TenantOut.model_validate(tenant),
        total_sales_idr=int(agg["total_sales"]),
        completed_transactions_count=int(agg["completed_cnt"]),
        voided_transactions_count=int(agg["voided_cnt"]),
        unique_stamps_count=int(tenant["unique_stamps_count"]),
        recent_transactions=[TransactionOut.model_validate(tx) for tx in recent_txs],
    )


@router.patch("/{tenant_id}", response_model=TenantEnvelope)
def update_booth_profile(
    tenant_id: str,
    payload: UpdateBoothProfileRequest,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> TenantEnvelope:
    _assert_booth_access(conn, tenant_id, current_user)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.tenants
                SET booth_name = %s,
                    booth_number = %s,
                    description = %s,
                    stamp_image_url = %s,
                    updated_at = %s
                WHERE id = %s
                RETURNING *
                """,
                (
                    payload.booth_name.strip(),
                    payload.booth_number.strip().upper(),
                    payload.description.strip(),
                    payload.stamp_image_url.strip(),
                    datetime.now(timezone.utc),
                    tenant_id,
                ),
            )
            updated = cur.fetchone()

    return TenantEnvelope(tenant=TenantOut.model_validate(updated))


@router.post(
    "/{tenant_id}/items",
    response_model=BoothItemEnvelope,
    status_code=status.HTTP_201_CREATED,
)
def create_booth_item(
    tenant_id: str,
    payload: CreateBoothItemRequest,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> BoothItemEnvelope:
    _assert_booth_access(conn, tenant_id, current_user)
    with conn.transaction():
        with conn.cursor() as cur:
            sort_order = payload.sort_order
            if sort_order is None:
                cur.execute(
                    "SELECT COALESCE(MAX(sort_order), 0)::INT + 1 AS next_order FROM public.tenant_items WHERE tenant_id = %s",
                    (tenant_id,),
                )
                sort_order = int(cur.fetchone()["next_order"])

            cur.execute(
                """
                INSERT INTO public.tenant_items (id, tenant_id, item_name, price_idr, sort_order, is_active, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    str(uuid.uuid4()),
                    tenant_id,
                    payload.item_name.strip(),
                    payload.price_idr,
                    sort_order,
                    payload.is_active,
                    datetime.now(timezone.utc),
                ),
            )
            item = cur.fetchone()

    return BoothItemEnvelope(item=TenantItemOut.model_validate(item))


@router.patch("/{tenant_id}/items/{item_id}", response_model=BoothItemEnvelope)
def update_booth_item(
    tenant_id: str,
    item_id: str,
    payload: UpdateBoothItemRequest,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> BoothItemEnvelope:
    _assert_booth_access(conn, tenant_id, current_user)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.tenant_items WHERE id = %s AND tenant_id = %s FOR UPDATE",
                (item_id, tenant_id),
            )
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Catalog item not found.",
                )

            cur.execute(
                """
                UPDATE public.tenant_items
                SET item_name = %s,
                    price_idr = %s,
                    is_active = %s,
                    sort_order = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (
                    payload.item_name.strip() if payload.item_name is not None else existing["item_name"],
                    payload.price_idr if payload.price_idr is not None else existing["price_idr"],
                    payload.is_active if payload.is_active is not None else existing["is_active"],
                    payload.sort_order if payload.sort_order is not None else existing["sort_order"],
                    item_id,
                    tenant_id,
                ),
            )
            updated = cur.fetchone()

    return BoothItemEnvelope(item=TenantItemOut.model_validate(updated))


@router.delete("/{tenant_id}/items/{item_id}", response_model=DeleteBoothItemResponse)
def delete_booth_item(
    tenant_id: str,
    item_id: str,
    current_user: dict[str, Any] = Depends(require_booth),
    conn: Connection[dict[str, Any]] = Depends(get_db),
) -> DeleteBoothItemResponse:
    _assert_booth_access(conn, tenant_id, current_user)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.tenant_items WHERE id = %s AND tenant_id = %s RETURNING id",
                (item_id, tenant_id),
            )
            deleted = cur.fetchone()
            if not deleted:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Catalog item not found.",
                )

    return DeleteBoothItemResponse(ok=True, id=str(deleted["id"]))
