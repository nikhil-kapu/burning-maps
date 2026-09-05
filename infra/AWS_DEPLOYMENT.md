# Turtle Buddy AWS deployment runbook

This runbook deliberately separates account selection from resource creation. The scripts refuse `default` and any profile name containing `enweave`, compare STS with an expected 12-digit account ID, and require a typed confirmation before CloudFormation creates chargeable resources.

## 1. Authenticate the dedicated account

Use a new profile name. Do not replace or reuse the Enweave profiles.

```bash
aws configure sso --profile turtle-buddy-prod
aws sso login --profile turtle-buddy-prod
aws sts get-caller-identity --profile turtle-buddy-prod
```

Before provisioning, verify the returned account ID and principal together. Then set:

```bash
export AWS_PROFILE=turtle-buddy-prod
export EXPECTED_AWS_ACCOUNT_ID=123456789012
export AWS_REGION=us-west-2
export ALERT_EMAIL=ops@your-domain.example
```

## 2. Create the infrastructure

`create-infrastructure.sh` creates a dedicated VPC, an ARM64 EC2 instance, encrypted gp3 storage, an Elastic IP, private versioned S3 backups, SSM access, least-purpose IAM, SNS, and CloudWatch alarms. There is no public SSH ingress.

```bash
./infra/aws/create-infrastructure.sh
```

Point the production API DNS `A` record at the stack's Elastic IP before starting Caddy. The default application configuration expects `api.turtlebuddy.app`, but the domain can be changed.

## 3. Add backend configuration through SSM

Start an SSM Session Manager shell on the stack's `InstanceId`. Create `/opt/turtle-buddy/shared/.env.production` with mode `0600`, using `infra/.env.production.example` as the field list. Generate separate random values for the database password, access-token secret, refresh-token pepper, and a 32-byte base64 field-encryption key. Never put these values in Git, the mobile bundle, a deployment archive, or terminal output captured for support.

Production provider requirements:

- SES: verify the sender/domain and request production sending access.
- Expo: set `PUSH_MODE=expo`; the mobile app must be an EAS development/production build, not Expo Go.
- Google Routes: create a backend-only key restricted to the Routes API and the production server's expected usage, then set `ROUTE_UPDATES_MODE=google` and `GOOGLE_ROUTES_API_KEY`. The iOS map itself uses Apple MapKit and does not receive this key.
- OpenRouter: choose a model that supports strict JSON-schema output, set `AGENT_BRIEF_MODE=openrouter`, and add backend-only `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` values. Only the free-form route brief is sent for constrained preference extraction; the model cannot trigger safety actions.
- Vapi: create a Turtle Buddy-specific assistant, outbound number, and private key; set the three `VAPI_*` values and `VOICE_MODE=vapi`. Calls go only to the traveler's verified profile number.
- Twilio: use a dedicated messaging sender, complete required registration/consent work, and set `SMS_MODE=twilio` plus the `TWILIO_*` values.

Keep voice recording/transcription off unless the user has been given an explicit disclosure and consent flow. Configure the Vapi assistant as read-only: spoken answers do not change journey state or trigger contact/emergency actions. Check-in, extension, and contact alerts remain authenticated app actions. Buddy route-update calls also require per-journey opt-in and are rate-limited by the backend.

## 4. Deploy the release

The deploy script verifies the same account again, uploads a secret-free release archive, executes migration and rollout through SSM, performs an API readiness check, updates the `current` release symlink only after success, and installs the nightly backup schedule.

```bash
./infra/scripts/deploy-via-ssm.sh
```

Verify `https://YOUR_DOMAIN/health/ready`, signup email delivery, push receipts, a provider test number, a backup object, and a restore drill before accepting customers.

## 5. Point the iOS build at production

Set `EXPO_PUBLIC_API_URL=https://YOUR_DOMAIN` for the EAS production profile, replace the placeholder EAS project ID and bundle identifier if needed, and complete every item in `APP_STORE_CHECKLIST.md`. Test location permission denial, background updates, expired-token refresh, notification delivery, and journey end on a real iPhone before App Store submission.
