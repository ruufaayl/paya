"""Theme 4 (super app) API. Customer endpoints act on the caller's own orders and consents only;
partner suspension is a Compliance control, audited."""
import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import services
from ..security import Principal
from .main import authorised

router = APIRouter()


class LookupIn(BaseModel):
    consumer_no: str = Field(min_length=10, max_length=10, pattern=r"^\d{10}$")


class ConsentIn(BaseModel):
    grant: bool


class LineIn(BaseModel):
    sku: str = Field(max_length=16)
    qty: int = Field(ge=1, le=services.MAX_QTY)


class OrderIn(BaseModel):
    consumer_no: str | None = Field(None, pattern=r"^\d{10}$")
    items: list[LineIn] | None = Field(None, max_length=services.MAX_LINES)
    amount_minor: int | None = Field(None, gt=0)
    use_offer: bool = False


class PartnerStatusIn(BaseModel):
    status: str = Field(pattern="^(ACTIVE|SUSPENDED)$")
    reason: str = Field(min_length=5, max_length=500)


@router.get("/v1/services", tags=["super app"])
def hub(p: Principal = Depends(authorised("services:use"))):
    return services.hub(uuid.UUID(p.customer_id))


@router.get("/v1/services/orders", tags=["super app"])
def orders(p: Principal = Depends(authorised("services:use"))):
    return services.my_orders(uuid.UUID(p.customer_id))


@router.post("/v1/services/{code}/bill-lookup", tags=["super app"])
def bill_lookup(code: str, body: LookupIn, p: Principal = Depends(authorised("services:use"))):
    return services.bill_lookup(uuid.UUID(p.customer_id), code, body.consumer_no)


@router.post("/v1/services/{code}/consent", tags=["super app"])
def consent(code: str, body: ConsentIn, request: Request, p: Principal = Depends(authorised("services:use"))):
    return services.set_consent(uuid.UUID(p.customer_id), code, body.grant, p.username, request.state.correlation_id)


@router.post("/v1/services/{code}/orders", status_code=201, tags=["super app"])
def order(code: str, body: OrderIn, request: Request, p: Principal = Depends(authorised("services:use"))):
    """Creates the order and its payment request only; the customer pays on the normal review screen."""
    return services.checkout(uuid.UUID(p.customer_id), code, actor=p.username, correlation_id=request.state.correlation_id,
                             consumer_no=body.consumer_no, amount_minor=body.amount_minor, use_offer=body.use_offer,
                             items=[i.model_dump() for i in body.items] if body.items else None)


@router.get("/v1/ops/partners", tags=["super app"])
def partners(p: Principal = Depends(authorised("backoffice:read"))):
    return services.partners_overview()


@router.post("/v1/ops/partners/{code}/status", tags=["super app"])
def partner_status(code: str, body: PartnerStatusIn, request: Request, p: Principal = Depends(authorised("partners:manage"))):
    return services.set_partner_status(code, body.status, body.reason, p.username, p.role, request.state.correlation_id)
