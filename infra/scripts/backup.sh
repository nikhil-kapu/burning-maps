#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET_FILE="/opt/turtle-buddy/backup-bucket"
[[ -f "${BUCKET_FILE}" ]] || { echo "Backup bucket file is missing." >&2; exit 2; }
BUCKET="$(<"${BUCKET_FILE}")"
[[ -n "${BUCKET}" ]] || { echo "Backup bucket is empty." >&2; exit 3; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_FILE="$(mktemp "/tmp/turtle-buddy-${STAMP}.sql.gz.XXXX")"
trap 'rm -f "${TMP_FILE}"' EXIT

cd "${ROOT_DIR}"
ENV_FILE=/opt/turtle-buddy/shared/.env.production docker compose --env-file /opt/turtle-buddy/shared/.env.production -p turtle-buddy-prod -f docker-compose.production.yml exec -T db pg_dump -U turtle -d turtle_buddy | gzip -9 > "${TMP_FILE}"
aws s3 cp "${TMP_FILE}" "s3://${BUCKET}/postgres/${STAMP}.sql.gz" --only-show-errors
echo "Uploaded encrypted-at-rest backup to s3://${BUCKET}/postgres/${STAMP}.sql.gz"
