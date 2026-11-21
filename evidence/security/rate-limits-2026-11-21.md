# Rate limiting: live check against the running API (2026-11-21)

Server: the local API with default limits (ADR-016), just after the stablecoin-sandbox browser run had signed several users in from the same address.

## 1. Login attempts per client address (limit 30 per sliding minute)

32 rapid logins with 32 *different* wrong usernames from one address. Status codes in order:

```
401 ×24, then 429 ×8
```

The limit bit at the 25th attempt, not the 31st: the browser run's logins from the same address a moment earlier were still inside the sliding window. A different username does not help an attacker, because the limit is per address.

The next attempt, by a valid user with the right password from the same address:

```
HTTP/1.1 429 Too Many Requests
retry-after: 53
{"error":{"code":"RATE_LIMITED","message":"too many requests; please wait and try again","scope":"login_ip","retry_after_s":53}, ...}
```

## 2. What is stored

`rate_limit_counters` (PostgreSQL, shared by every API process, survives restarts):

```
login_fail|0e3dc3b1cd3b68da18fc534b4d9e0872|1795293900|1
login_fail|29de9738f4195be13991cf81a44c5c0c|1795293900|1
...
```

Keys are HMAC-SHA256 hashes. No address or username is stored.

## 3. Normal use is not affected

With the same default limits, every browser suite and the rehearsal passed, and the API log shows **0** rate-limit refusals:
- revamp 33/33;
- assistant 8/8;
- green 14/14;
- services 14/14;
- sandbox 10/10;
- demo rehearsal 8/8.

Automated tests: `tests/test_ratelimit.py` (L1–L9).
