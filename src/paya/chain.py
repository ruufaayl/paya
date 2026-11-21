"""A SIMULATED token chain for the stablecoin sandbox (Theme 5). Not a blockchain client.

It models the behaviours a tokenised-money rail has that Raast does not:
* transactions wait in a mempool, then are included in blocks;
* "included" is not "final": a block can be orphaned (reorg) and its transactions return to the mempool;
* finality is a number of confirmations, not an acknowledgement;
* the chain can be congested (empty blocks) or unreachable.

The only asset is a TEST token with no value ("tPKR-TEST"). It is created solely by the sandbox faucet
and cannot be exchanged for rupees: there is no on-ramp or off-ramp. Like the Raast simulator, it has
its own schema ("chain"), so Paya's records can be reconciled against it. A real, SBP-approved
instrument would replace it behind the same small interface (submit / mine / status / balance).
"""
import hashlib
import threading
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, func, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .db import session_scope

FAUCET = "0x" + "0" * 36 + "fa0c"
TOKEN = "tPKR-TEST"
CHAIN_NAME = "Paya sandbox chain (simulated)"
MODES = ("NORMAL", "CONGESTED", "REORG", "DOWN")


class ChainBase(DeclarativeBase):
    pass


class ChainBlock(ChainBase):
    __tablename__ = "blocks"
    __table_args__ = {"schema": "chain"}
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    height: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    hash: Mapped[str] = mapped_column(String(66), unique=True, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(66), nullable=False)
    tx_count: Mapped[int] = mapped_column(Integer, nullable=False)
    orphaned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ChainTx(ChainBase):
    __tablename__ = "txs"
    __table_args__ = {"schema": "chain"}
    hash: Mapped[str] = mapped_column(String(66), primary_key=True)
    from_addr: Mapped[str] = mapped_column(String(42), nullable=False, index=True)
    to_addr: Mapped[str] = mapped_column(String(42), nullable=False, index=True)
    amount_units: Mapped[int] = mapped_column(BigInteger, nullable=False)   # hundredths of a test token
    memo: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)          # MEMPOOL | INCLUDED
    block_id: Mapped[int | None] = mapped_column(BigInteger)
    block_height: Mapped[int | None] = mapped_column(Integer)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ChainUnavailable(Exception):
    """The node refused the connection: the transaction was definitely not received."""


class ChainRejected(Exception):
    """The chain rejected the transaction (e.g. the sender's on-chain balance is too low)."""


class Chaos:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def set_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown chain mode {mode}")
        with self._lock:
            self.mode = mode

    def reset(self) -> None:
        self.mode = "NORMAL"

    def state(self) -> dict:
        return {"mode": self.mode, "modes": list(MODES)}


chaos = Chaos()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _h(*parts) -> str:
    return "0x" + hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()


def _tip(s) -> ChainBlock | None:
    return s.execute(select(ChainBlock).where(ChainBlock.orphaned.is_(False))
                     .order_by(ChainBlock.height.desc()).limit(1)).scalar_one_or_none()


def height() -> int:
    with session_scope() as s:
        t = _tip(s)
        return t.height if t else 0


def _balance(s, addr: str, *, include_mempool_out: bool = False, max_height: int | None = None) -> int:
    def total(col, status_ok):
        q = select(func.coalesce(func.sum(ChainTx.amount_units), 0)).where(col == addr, ChainTx.status.in_(status_ok))
        if max_height is not None:
            q = q.where((ChainTx.block_height <= max_height) | (ChainTx.status == "MEMPOOL"))
        return int(s.execute(q).scalar_one())
    inc = total(ChainTx.to_addr, ["INCLUDED"])
    out = total(ChainTx.from_addr, ["INCLUDED", "MEMPOOL"] if include_mempool_out else ["INCLUDED"])
    return inc - out


def balance(addr: str, min_confirmations: int = 1) -> int:
    """Balance from transactions with at least `min_confirmations` (1 = included in the current chain)."""
    with session_scope() as s:
        t = _tip(s)
        if t is None:
            return 0
        return _balance(s, addr, max_height=t.height - min_confirmations + 1)


def submit(from_addr: str, to_addr: str, amount_units: int, memo: str) -> str:
    if chaos.mode == "DOWN":
        raise ChainUnavailable("sandbox node refused the connection")
    if amount_units <= 0:
        raise ChainRejected("amount must be positive")
    with session_scope() as s:
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"chain:{from_addr}"})
        if from_addr != FAUCET and _balance(s, from_addr, include_mempool_out=True) < amount_units:
            raise ChainRejected("insufficient on-chain balance")
        now = _now()
        h = _h(from_addr, to_addr, amount_units, memo, now.isoformat())
        s.add(ChainTx(hash=h, from_addr=from_addr, to_addr=to_addr, amount_units=amount_units, memo=memo[:64],
                      status="MEMPOOL", submitted_at=now))
        return h


def mine(max_txs: int = 50) -> dict:
    """Produce one block. CONGESTED: an empty block. REORG: orphan the current tip instead (its
    transactions go back to the mempool), then return to NORMAL - one reorg per request."""
    with session_scope() as s:
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext('chain:mine'))"))
        tip = _tip(s)
        if chaos.mode == "REORG" and tip is not None:
            tip.orphaned = True
            for tx in s.execute(select(ChainTx).where(ChainTx.block_id == tip.id)).scalars():
                tx.status, tx.block_id, tx.block_height = "MEMPOOL", None, None
            chaos.set_mode("NORMAL")
            return {"reorg": True, "orphaned_height": tip.height}
        txs = [] if chaos.mode == "CONGESTED" else s.execute(
            select(ChainTx).where(ChainTx.status == "MEMPOOL").order_by(ChainTx.submitted_at).limit(max_txs)).scalars().all()
        hgt = (tip.height if tip else 0) + 1
        prev = tip.hash if tip else "0x" + "0" * 64
        b = ChainBlock(height=hgt, hash=_h(prev, hgt, *[t.hash for t in txs], _now().isoformat()), prev_hash=prev,
                       tx_count=len(txs), mined_at=_now())
        s.add(b)
        s.flush()
        for t in txs:
            t.status, t.block_id, t.block_height = "INCLUDED", b.id, hgt
        return {"height": hgt, "txs": len(txs)}


def tx_status(tx_hash: str) -> dict:
    with session_scope() as s:
        tx = s.get(ChainTx, tx_hash)
        if tx is None:
            return {"status": "UNKNOWN", "confirmations": 0}
        tip = _tip(s)
        conf = (tip.height - tx.block_height + 1) if tx.status == "INCLUDED" and tip else 0
        return {"status": tx.status, "confirmations": conf, "block_height": tx.block_height,
                "from": tx.from_addr, "to": tx.to_addr, "amount_units": tx.amount_units}


def last_mined_at() -> datetime | None:
    with session_scope() as s:
        t = _tip(s)
        return t.mined_at if t else None


def overview(n: int = 8) -> dict:
    with session_scope() as s:
        blocks = s.execute(select(ChainBlock).order_by(ChainBlock.id.desc()).limit(n)).scalars().all()
        mempool = s.execute(select(func.count()).select_from(ChainTx).where(ChainTx.status == "MEMPOOL")).scalar_one()
        tip = _tip(s)
        return {"name": CHAIN_NAME, "token": TOKEN, "height": tip.height if tip else 0, "mempool": mempool,
                "chaos": chaos.state(),
                "blocks": [{"height": b.height, "hash": b.hash[:18], "txs": b.tx_count, "orphaned": b.orphaned,
                            "at": b.mined_at.isoformat()} for b in blocks]}
