"""What the migrations describe: every table Paya owns, across the four schemas."""
from paya import models  # noqa: F401  (register tables)
from paya.chain import ChainBase
from paya.db import Base
from paya.rail import RailBase
from paya.registry import RegistryBase

TARGET = [Base.metadata, RailBase.metadata, RegistryBase.metadata, ChainBase.metadata]
SCHEMAS = {None, "public", "rail", "registry", "chain"}


def include_name(name, type_, parent_names):
    if type_ == "schema":
        return name in SCHEMAS
    return True
