#!/usr/bin/env bash
set -euo pipefail

: "${AWS_PROFILE:?Set AWS_PROFILE to the dedicated Turtle Buddy profile.}"
: "${EXPECTED_AWS_ACCOUNT_ID:?Set EXPECTED_AWS_ACCOUNT_ID.}"
case "${AWS_PROFILE}" in *enweave*|default) echo "Refusing profile ${AWS_PROFILE}." >&2; exit 2;; esac

AWS_REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="${STACK_NAME:-turtle-buddy-production}"
ACTUAL_ACCOUNT_ID="$(aws sts get-caller-identity --profile "${AWS_PROFILE}" --query Account --output text)"
[[ "${ACTUAL_ACCOUNT_ID}" == "${EXPECTED_AWS_ACCOUNT_ID}" ]] || { echo "AWS account mismatch." >&2; exit 3; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTANCE_ID="$(aws cloudformation describe-stacks --profile "${AWS_PROFILE}" --region "${AWS_REGION}" --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)"
BUCKET="$(aws cloudformation describe-stacks --profile "${AWS_PROFILE}" --region "${AWS_REGION}" --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='BackupBucketName'].OutputValue" --output text)"
[[ -n "${INSTANCE_ID}" && -n "${BUCKET}" ]] || { echo "Stack outputs are missing." >&2; exit 4; }

ARCHIVE="$(mktemp "/tmp/turtle-buddy-release.XXXXXX.tgz")"
trap 'rm -f "${ARCHIVE}"' EXIT
tar -C "${PROJECT_DIR}" --exclude=node_modules --exclude=.env --exclude=.env.production --exclude=.npm-cache -czf "${ARCHIVE}" backend infra package.json package-lock.json .dockerignore
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="releases/turtle-buddy-${RELEASE_ID}.tgz"
aws s3 cp "${ARCHIVE}" "s3://${BUCKET}/${KEY}" --profile "${AWS_PROFILE}" --region "${AWS_REGION}" --only-show-errors

REMOTE_ARCHIVE="/tmp/turtle-buddy-${RELEASE_ID}.tgz"
REMOTE_STAGE="/tmp/turtle-buddy-${RELEASE_ID}"
REMOTE_RELEASE="/opt/turtle-buddy/releases/${RELEASE_ID}"
COMMANDS=(
  "set -euo pipefail"
  "test -f /opt/turtle-buddy/shared/.env.production || { echo 'Missing /opt/turtle-buddy/shared/.env.production'; exit 10; }"
  "test ! -e ${REMOTE_STAGE} && mkdir -p ${REMOTE_STAGE} ${REMOTE_RELEASE}"
  "aws s3 cp s3://${BUCKET}/${KEY} ${REMOTE_ARCHIVE}"
  "tar -xzf ${REMOTE_ARCHIVE} -C ${REMOTE_STAGE}"
  "cp -a ${REMOTE_STAGE}/backend ${REMOTE_STAGE}/infra ${REMOTE_RELEASE}/"
  "cd ${REMOTE_RELEASE}/infra && ENV_FILE=/opt/turtle-buddy/shared/.env.production docker compose --env-file /opt/turtle-buddy/shared/.env.production -p turtle-buddy-prod -f docker-compose.production.yml build --pull api"
  "cd ${REMOTE_RELEASE}/infra && ENV_FILE=/opt/turtle-buddy/shared/.env.production docker compose --env-file /opt/turtle-buddy/shared/.env.production -p turtle-buddy-prod -f docker-compose.production.yml run --rm api node dist/scripts/migrate.js"
  "cd ${REMOTE_RELEASE}/infra && ENV_FILE=/opt/turtle-buddy/shared/.env.production docker compose --env-file /opt/turtle-buddy/shared/.env.production -p turtle-buddy-prod -f docker-compose.production.yml up -d --remove-orphans"
  "cd ${REMOTE_RELEASE}/infra && ENV_FILE=/opt/turtle-buddy/shared/.env.production docker compose --env-file /opt/turtle-buddy/shared/.env.production -p turtle-buddy-prod -f docker-compose.production.yml exec -T api node -e \"fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""
  "ln -sfn ${REMOTE_RELEASE} /opt/turtle-buddy/current"
  "printf '17 3 * * * root /opt/turtle-buddy/current/infra/scripts/backup.sh >> /var/log/turtle-buddy-backup.log 2>&1\\n' > /etc/cron.d/turtle-buddy-backup && chmod 0644 /etc/cron.d/turtle-buddy-backup"
)
PARAMETERS_JSON="$(node -e 'process.stdout.write(JSON.stringify({commands: process.argv.slice(1)}))' "${COMMANDS[@]}")"
[[ -n "${PARAMETERS_JSON}" ]] || { echo "Could not build SSM command parameters." >&2; exit 5; }

COMMAND_ID="$(aws ssm send-command \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" \
  --instance-ids "${INSTANCE_ID}" \
  --document-name AWS-RunShellScript \
  --parameters "${PARAMETERS_JSON}" \
  --query 'Command.CommandId' \
  --output text)"

echo "SSM command: ${COMMAND_ID}"
aws ssm wait command-executed --profile "${AWS_PROFILE}" --region "${AWS_REGION}" --command-id "${COMMAND_ID}" --instance-id "${INSTANCE_ID}"
aws ssm get-command-invocation --profile "${AWS_PROFILE}" --region "${AWS_REGION}" --command-id "${COMMAND_ID}" --instance-id "${INSTANCE_ID}" --output json
