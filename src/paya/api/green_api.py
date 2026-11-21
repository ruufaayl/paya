"""Theme 2 (green banking) API. Customer endpoints are scoped to the caller's own wallet; the Mission
Control endpoint returns portfolio aggregates only (no individual customer's footprint)."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import green
from ..idempotency import execute as idempotent
from ..security import Principal
from .main import _payment_request_view, authorised, principal

router = APIRouter()


class PotMoveIn(BaseModel):
    direction: str = Field(pattern="^(IN|OUT)$")
    amount_minor: int = Field(gt=0, le=green.POT_MAX_MINOR)
    source: str = Field(default="MANUAL", pattern="^(MANUAL|ROUND_UP)$")


class OffsetIn(BaseModel):
    amount_minor: int = Field(ge=green.OFFSET_MIN_MINOR, le=green.OFFSET_MAX_MINOR)


@router.get("/v1/green/footprint", tags=["green"])
def footprint(days: int = Query(30, ge=7, le=90), p: Principal = Depends(authorised("green:use"))):
    return green.footprint(uuid.UUID(p.customer_id), days)


@router.get("/v1/green/factors", tags=["green"])
def factors(p: Principal = Depends(principal)):
    return green.factor_table()


@router.get("/v1/green/pot", tags=["green"])
def pot(p: Principal = Depends(authorised("green:use"))):
    return green.pot_view(uuid.UUID(p.customer_id))


@router.post("/v1/green/pot/moves", tags=["green"])
def pot_move(body: PotMoveIn, request: Request, p: Principal = Depends(authorised("green:use")),
             idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None):
    cid = request.state.correlation_id

    def run():
        return 200, green.move(uuid.UUID(p.customer_id), direction=body.direction, amount_minor=body.amount_minor,
                               source=body.source, actor=p.username, correlation_id=cid)

    code, resp, replayed = idempotent(principal=p.user_id, operation="POST /v1/green/pot/moves", key=idempotency_key,
                                      body=body.model_dump(mode="json"), fn=run)
    return JSONResponse(status_code=code, content=resp, headers={"Idempotent-Replayed": str(replayed).lower()})


@router.get("/v1/green/offsets", tags=["green"])
def offsets(p: Principal = Depends(authorised("green:use"))):
    return green.offsets(uuid.UUID(p.customer_id))


@router.post("/v1/green/offsets", status_code=201, tags=["green"])
def offset_request(body: OffsetIn, p: Principal = Depends(authorised("green:use"))):
    """Creates a payment request only. The customer pays it through the normal review and Raast path."""
    return _payment_request_view(green.create_offset_request(uuid.UUID(p.customer_id), body.amount_minor, p.username))


@router.get("/v1/ops/green/portfolio", tags=["green"])
def portfolio(p: Principal = Depends(authorised("backoffice:read"))):
    return green.portfolio()
