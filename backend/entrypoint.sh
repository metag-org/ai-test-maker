#!/usr/bin/env bash
set -e

echo "Waiting for PostgreSQL and running Alembic migrations..."
for i in $(seq 1 30); do
  if alembic upgrade head; then
    echo "Database migrations applied successfully."
    break
  fi
  echo "Database not ready yet ($i/30), retrying in 2s..."
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "Failed to apply migrations after 30 attempts."
    exit 1
  fi
done

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
