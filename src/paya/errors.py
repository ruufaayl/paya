"""Business errors with a stable code and HTTP status (the API error model)."""


class PayaError(Exception):
    code = "PAYA_ERROR"
    http_status = 400

    def __init__(self, message: str, **details):
        super().__init__(message)
        self.message = message
        self.details = details


def _make(name: str, code: str, status: int):
    return type(name, (PayaError,), {"code": code, "http_status": status})


NotFound = _make("NotFound", "NOT_FOUND", 404)
Forbidden = _make("Forbidden", "FORBIDDEN", 403)
Unauthenticated = _make("Unauthenticated", "UNAUTHENTICATED", 401)
ValidationFailed = _make("ValidationFailed", "VALIDATION_FAILED", 422)
PaymentRequestClosed = _make("PaymentRequestClosed", "PAYMENT_REQUEST_CLOSED", 409)
PaymentAlreadyInProgress = _make("PaymentAlreadyInProgress", "PAYMENT_ALREADY_IN_PROGRESS", 409)
IdempotencyInProgress = _make("IdempotencyInProgress", "IDEMPOTENCY_IN_PROGRESS", 409)
IdempotencyKeyReused = _make("IdempotencyKeyReused", "IDEMPOTENCY_KEY_REUSED", 422)
InsufficientFunds = _make("InsufficientFunds", "INSUFFICIENT_FUNDS", 422)
RailUnavailableError = _make("RailUnavailableError", "RAIL_UNAVAILABLE", 503)
InvalidState = _make("InvalidState", "INVALID_STATE", 409)
SegregationOfDuties = _make("SegregationOfDuties", "SEGREGATION_OF_DUTIES", 403)
LoginLocked = _make("LoginLocked", "LOGIN_LOCKED", 429)
RateLimited = _make("RateLimited", "RATE_LIMITED", 429)
FeatureDisabled = _make("FeatureDisabled", "FEATURE_DISABLED", 404)
