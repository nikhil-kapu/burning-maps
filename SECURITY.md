# Security policy and operating boundaries

## Safety boundary

Turtle Buddy is a personal check-in and trusted-contact tool. It is not an emergency service, security service, navigation authority, or guarantee of safety. Automatic emergency-service calls are intentionally out of scope. A user may open the system dialer and place an emergency call themselves.

## Sensitive data

Treat all of the following as sensitive: credentials, refresh tokens, email addresses, phone numbers, journey notes, precise location, provider credentials, recovery codes, public status tokens, and contact relationships.

Never commit `.env` files or paste production credentials into tickets, logs, screenshots, or mobile configuration. The mobile bundle may contain only public configuration such as the API base URL.

## Production requirements

- Rotate the JWT signing key and provider secrets through a controlled deployment.
- Use a verified SES identity and a dedicated sender domain.
- Restrict database access to the private Docker network.
- Enable encrypted EBS, S3 default encryption, versioning, lifecycle policies, and MFA on the AWS owner account.
- Run dependency and container scans before each release.
- Test account deletion, token revocation, missed-check-in idempotency, and provider retry behavior before launch.
- Maintain incident response and lawful data request procedures.

## Reporting

Until a public security address is configured, report issues privately to the repository owner. Do not include personal location or contact data in a report.

