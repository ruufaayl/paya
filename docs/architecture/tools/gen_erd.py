"""Generate the ERD (Mermaid) and table dictionary from the live SQLAlchemy metadata.

Run:  python docs/architecture/tools/gen_erd.py  -> writes docs/architecture/generated/erd.mmd and table-dictionary.md
Generated from code, so the documented data model can never drift from the implemented one.
"""
from pathlib import Path

from sqlalchemy import CheckConstraint, UniqueConstraint

from paya import models  # noqa: F401  (registers tables)
from paya.db import Base
from paya.rail import RailBase

OUT = Path(__file__).resolve().parents[1] / "generated"
OUT.mkdir(exist_ok=True)
tables = list(Base.metadata.sorted_tables) + list(RailBase.metadata.sorted_tables)


def mtype(col) -> str:
    t = type(col.type).__name__.lower()
    return {"uuid": "uuid", "biginteger": "bigint", "integer": "int", "string": "varchar", "text": "text",
            "datetime": "timestamptz", "date": "date", "boolean": "bool", "jsonb": "jsonb"}.get(t, t)


def name(t) -> str:
    return f"rail_{t.name}" if t.schema == "rail" else t.name


lines = ["erDiagram"]
for t in tables:
    uniques = {c.name for c in t.columns if c.unique}
    for con in t.constraints:
        if isinstance(con, UniqueConstraint) and len(con.columns) == 1:
            uniques |= {c.name for c in con.columns}
    lines.append(f"  {name(t)} {{")
    for c in t.columns:
        keys = [k for k, ok in (("PK", c.primary_key), ("FK", bool(c.foreign_keys)), ("UK", c.name in uniques)) if ok]
        lines.append(f"    {mtype(c)} {c.name}{' ' + ','.join(keys) if keys else ''}")
    lines.append("  }")
for t in tables:
    for fk in t.foreign_keys:
        parent = fk.column.table
        if parent is t:
            label = "corrects"
        else:
            label = fk.parent.name.replace("_id", "")
        card = "||--o|" if fk.parent.unique else "||--o{"
        lines.append(f'  {name(parent)} {card} {name(t)} : "{label}"')
(OUT / "erd.mmd").write_text("\n".join(lines) + "\n")
(OUT / "erd-full.md").write_text("# Full ERD (generated from `src/paya/models.py`)\n\n```mermaid\n" + "\n".join(lines) + "\n```\n")

doc = ["# Table dictionary (generated from `src/paya/models.py`)", "",
       "Do not edit by hand. Run `python docs/architecture/tools/gen_erd.py`.", ""]
for t in tables:
    doc.append(f"## `{name(t)}`")
    doc.append("")
    if t.comment:
        doc.append(t.comment)
    doc.append("| Column | Type | Null | Key |")
    doc.append("|---|---|---|---|")
    for c in t.columns:
        key = "PK" if c.primary_key else ("FK → " + ", ".join(f"{f.column.table.name}.{f.column.name}" for f in c.foreign_keys)) if c.foreign_keys else ("UNIQUE" if c.unique else "")
        doc.append(f"| `{c.name}` | {mtype(c)} | {'yes' if c.nullable else 'no'} | {key} |")
    cons = [c for c in t.constraints if isinstance(c, (CheckConstraint, UniqueConstraint)) and c.name]
    if cons:
        doc.append("")
        doc.append("Constraints:")
        for c in cons:
            body = str(c.sqltext) if isinstance(c, CheckConstraint) else "UNIQUE(" + ", ".join(col.name for col in c.columns) + ")"
            doc.append(f"- `{c.name}`: `{body}`")
    doc.append("")
(OUT / "table-dictionary.md").write_text("\n".join(doc))
print(f"{len(tables)} tables -> {OUT}")
