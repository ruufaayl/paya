"""Sessions, revocation and staff MFA endpoints (ADR-017)."""
import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth
from ..errors import NotFound
from ..security import Principal
from .main import authorised, principal

router = APIRouter()


class ChallengeCodeIn(BaseModel):
    challenge: str = Field(max_length=2048)
    code: str = Field(min_length=6, max_length=8)


class ChallengeIn(BaseModel):
    challenge: str = Field(max_length=2048)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=5, max_length=200)


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


# ---- second step of sign-in (challenge tokens; no access token yet)
@router.post("/v1/auth/mfa/verify", tags=["auth"])
def mfa_verify(body: ChallengeCodeIn, request: Request):
    return auth.verify_login(body.challenge, body.code, user_agent=_ua(request), correlation_id=request.state.correlation_id)


@router.post("/v1/auth/mfa/setup", tags=["auth"])
def mfa_setup_from_challenge(body: ChallengeIn):
    """Enforced enrolment: the password produced a setup challenge; get a secret for an authenticator app."""
    return auth.start_enrolment(challenge=body.challenge)


@router.post("/v1/auth/mfa/setup/confirm", tags=["auth"])
def mfa_confirm_from_challenge(body: ChallengeCodeIn, request: Request):
    return auth.confirm_enrolment(body.code, challenge=body.challenge, user_agent=_ua(request),
                                  correlation_id=request.state.correlation_id)


# ---- signed-in user
@router.post("/v1/auth/mfa/enrol", tags=["auth"])
def mfa_enrol(p: Principal = Depends(principal)):
    return auth.start_enrolment(principal=p)


@router.post("/v1/auth/mfa/enrol/confirm", tags=["auth"])
def mfa_enrol_confirm(body: CodeIn, request: Request, p: Principal = Depends(principal)):
    return auth.confirm_enrolment(body.code, principal=p, user_agent=_ua(request),
                                  correlation_id=request.state.correlation_id, current_sid=p.sid)


@router.post("/v1/auth/logout", tags=["auth"])
def logout(p: Principal = Depends(principal)):
    if p.sid:
        auth.revoke(uuid.UUID(p.sid), by=p.username, reason="signed out", user_id=uuid.UUID(p.user_id))
    return {"signed_out": True}


@router.get("/v1/auth/sessions", tags=["auth"])
def sessions(p: Principal = Depends(principal)):
    return auth.list_sessions(uuid.UUID(p.user_id), p.sid)


@router.post("/v1/auth/sessions/{session_id}/revoke", tags=["auth"])
def revoke_one(session_id: uuid.UUID, p: Principal = Depends(principal)):
    if not auth.revoke(session_id, by=p.username, reason="signed out by user", user_id=uuid.UUID(p.user_id)):
        raise NotFound("no such active session of yours")
    return {"revoked": True}


@router.post("/v1/auth/sessions/revoke-others", tags=["auth"])
def revoke_others(p: Principal = Depends(principal)):
    keep = uuid.UUID(p.sid) if p.sid else None
    return {"revoked": auth.revoke_all(uuid.UUID(p.user_id), by=p.username, reason="signed out everywhere else", keep=keep)}


# ---- administration (SYSADMIN), audited
@router.get("/v1/admin/staff-security", tags=["auth"])
def staff_security(p: Principal = Depends(authorised("sessions:revoke"))):
    return auth.staff_overview()


@router.post("/v1/admin/users/{username}/sessions/revoke", tags=["auth"])
def admin_revoke(username: str, body: ReasonIn, request: Request, p: Principal = Depends(authorised("sessions:revoke"))):
    return auth.admin_revoke(username, actor=p, reason=body.reason, correlation_id=request.state.correlation_id)


@router.post("/v1/admin/users/{username}/mfa/reset", tags=["auth"])
def admin_reset_mfa(username: str, body: ReasonIn, request: Request, p: Principal = Depends(authorised("sessions:revoke"))):
    return auth.admin_revoke(username, actor=p, reason=body.reason, correlation_id=request.state.correlation_id,
                             reset_mfa=True)
