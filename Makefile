.PHONY: models setup test run up down openapi verify web demo-reset rehearse
setup:            ## create virtualenv, install, and fetch the face models
	python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && $(MAKE) models
models:           ## download the onboarding face models (checksums pinned)
	.venv/bin/python -m paya.fetch_models models
test:             ## run all scenario tests (needs Postgres; see README)
	.venv/bin/python -m pytest -p no:warnings
run:              ## run the API locally with auto-reload
	.venv/bin/uvicorn paya.api.main:app --reload --port 8000
up:               ## one-command local stack (Postgres + API)
	docker compose -f infra/docker-compose.yml --env-file .env up --build
down:
	docker compose -f infra/docker-compose.yml down
openapi:          ## export the OpenAPI contract to /api
	.venv/bin/python -c "import json;from paya.api.main import app;json.dump(app.openapi(),open('api/openapi.json','w'),indent=2)"
web:              ## build the PWA and Mission Control
	cd web && npm ci && npm run build
verify: test web  ## everything a reviewer needs: all tests plus a production web build
demo-reset:       ## wipe demo data and start fresh (synthetic seed only) - run before every demo
	docker compose -f infra/docker-compose.yml --env-file .env down -v
	docker compose -f infra/docker-compose.yml --env-file .env up -d
rehearse:         ## automated demo rehearsal. Run `make demo-reset` first (and the web preview on :4173)
	node docs/architecture/tools/demo_rehearsal.cjs
