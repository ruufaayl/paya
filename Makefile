.PHONY: setup test run up down openapi verify web
setup:            ## create virtualenv and install
	python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
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
