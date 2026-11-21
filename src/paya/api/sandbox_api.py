"""Theme 5 (stablecoin sandbox) API. Every customer endpoint answers 404 FEATURE_DISABLED unless the server
runs with PAYA_STABLECOIN_SANDBOX=true. Nothing here touches the rupee ledger."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import chain, tokens
from ..errors import ValidationFailed
from ..idempotency import execute as idempotent
from ..security import Principal
from .main import authorised, principal

router = APIRouter()


class EnrolIn(BaseModel):
    acknowledge_no_value: bool


class SendIn(BaseModel):
    amount_units: int = Field(gt=0)
    merchant_id: uuid.UUID | None = None
    to_address: str | None = Field(None, max_length=42)
    beneficiary_name: str | None = Field(None, max_length=128)


class ChainChaosIn(BaseModel):
    mode: str = Field(pattern="^(NORMAL|CONGESTED|REORG|DOWN)$")


@router.get("/v1/sandbox/status", tags=["stablecoin sandbox"])
def status(p: Principal = Depends(principal)):
    return {"enabled": tokens.enabled()}


@router.get("/v1/sandbox/wallet", tags=["stablecoin sandbox"])
def wallet(p: Principal = Depends(authorised("sandbox:use"))):
    return tokens.view(uuid.UUID(p.customer_id))


@router.post("/v1/sandbox/enrol", tags=["stablecoin sandbox"])
def enrol(body: EnrolIn, request: Request, p: Principal = Depends(authorised("sandbox:use"))):
    return tokens.enrol(uuid.UUID(p.customer_id), body.acknowledge_no_value, p.username, request.state.correlation_id)


@router.post("/v1/sandbox/faucet", tags=["stablecoin sandbox"])
def faucet(request: Request, p: Principal = Depends(authorised("sandbox:use"))):
    return tokens.faucet(uuid.UUID(p.customer_id), p.username, request.state.correlation_id)


@router.post("/v1/sandbox/transfers", tags=["stablecoin sandbox"])
def send(body: SendIn, request: Request, p: Principal = Depends(authorised("sandbox:use")),
         idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None):
    tokens.require_enabled()
    cid = request.state.correlation_id

    def run():
        return 200, tokens.send(uuid.UUID(p.customer_id), amount_units=body.amount_units, actor=p.username,
                                correlation_id=cid, merchant_id=body.merchant_id, to_address=body.to_address,
                                beneficiary_name=body.beneficiary_name)

    code, resp, replayed = idempotent(principal=p.user_id, operation="POST /v1/sandbox/transfers", key=idempotency_key,
                                      body=body.model_dump(mode="json"), fn=run)
    return JSONResponse(status_code=code, content=resp, headers={"Idempotent-Replayed": str(replayed).lower()})


@router.get("/v1/ops/sandbox", tags=["stablecoin sandbox"])
def overview(p: Principal = Depends(authorised("backoffice:read"))):
    return tokens.overview()


@router.post("/v1/chaos/chain", tags=["stablecoin sandbox"])
def chain_chaos(body: ChainChaosIn, p: Principal = Depends(authorised("chaos:control"))):
    tokens.require_enabled()
    chain.chaos.set_mode(body.mode)
    return chain.chaos.state()


@router.post("/v1/ops/sandbox/mine", tags=["stablecoin sandbox"])
def mine(p: Principal = Depends(authorised("chaos:control"))):
    """Produce a block now (demo stepping); the worker also mines on its interval."""
    tokens.require_enabled()
    out = chain.mine()
    out.update(tokens.refresh())
    return out
