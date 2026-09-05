#!/usr/bin/env bash
set -euo pipefail

: "${AWS_PROFILE:?Set AWS_PROFILE to a dedicated, non-Enweave profile.}"
: "${EXPECTED_AWS_ACCOUNT_ID:?Set EXPECTED_AWS_ACCOUNT_ID to the target 12-digit AWS account ID.}"

case "${AWS_PROFILE}" in
  *enweave*|default)
    echo "Refusing AWS profile '${AWS_PROFILE}'. Use a dedicated Turtle Buddy profile." >&2
    exit 2
    ;;
esac

AWS_REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="${STACK_NAME:-turtle-buddy-production}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

ACTUAL_ACCOUNT_ID="$(aws sts get-caller-identity --profile "${AWS_PROFILE}" --query Account --output text)"
if [[ "${ACTUAL_ACCOUNT_ID}" != "${EXPECTED_AWS_ACCOUNT_ID}" ]]; then
  echo "Account mismatch. Expected ${EXPECTED_AWS_ACCOUNT_ID}; STS returned ${ACTUAL_ACCOUNT_ID}." >&2
  exit 3
fi

echo "Target account: ${ACTUAL_ACCOUNT_ID}"
echo "Profile: ${AWS_PROFILE}"
echo "Region: ${AWS_REGION}"
echo "Stack: ${STACK_NAME}"
echo "This creates chargeable EC2, EBS, Elastic IP, S3, and CloudWatch resources."
read -r -p "Type CREATE TURTLE BUDDY to continue: " CONFIRMATION
[[ "${CONFIRMATION}" == "CREATE TURTLE BUDDY" ]] || { echo "Cancelled."; exit 4; }

aws cloudformation deploy \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "$(dirname "$0")/cloudformation.yml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "AlertEmail=${ALERT_EMAIL}" \
  --tags Product=TurtleBuddy Environment=production

aws cloudformation describe-stacks \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs' \
  --output table
