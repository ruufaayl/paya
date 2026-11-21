# Reproducibility check (2026-11-21)

## 1. Fresh clone from GitHub, on a machine state with nothing pre-installed for the project

| Step | Command | Result | Time |
|---|---|---|---|
| Clone | `git clone --depth 1 https://github.com/ruufaayl/paya` | commit `7801e70` | — |
| Python install | `python3 -m venv .venv && pip install -e ".[dev]"` | ok | 8 s |
| Tests on an **empty** database | `PAYA_DATABASE_URL=…/paya_clean pytest` | **32 passed** | 24 s |
| Web build | `cd web && npm ci && npm run build` | built | 9 s |
| API image | `docker build -f infra/Dockerfile.api .` | built | 29 s |
| AI evaluation | `python docs/architecture/tools/ai_eval.py` | identical metrics; **no files changed** (deterministic, seed 2026) | < 1 s |

## 2. Continuous integration

GitHub Actions workflow `.github/workflows/ci.yml` runs on every push:
- backend tests against a PostgreSQL 16 service container;
- the AI evaluation;
- `pip-audit`;
- the web build;
- the image build.

First run: **success in 52 s**. https://github.com/ruufaayl/paya/actions/runs/44861732656

## 3. Restart robustness found during this check

After a host restart, only the API container came back (it had `restart: unless-stopped`; the database did not). The API crash-looped on `failed to resolve host 'db'`. **Fixed:** the database now has the same restart policy (`infra/docker-compose.yml`).

## 4. One-command paths

| Goal | Command |
|---|---|
| Run the stack | `cp .env.example .env` (set `PAYA_JWT_SECRET`), then `make up` |
| Everything a reviewer needs | `make verify` (all tests plus production web build) |
| Fresh demo data | `make demo-reset` (deletes the demo DB volume and re-seeds; synthetic only) |
| Demo rehearsal | `make demo-reset && make rehearse` |
