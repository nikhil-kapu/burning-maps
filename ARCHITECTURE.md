# Turtle Maps production architecture

## Product principle

Turtle Maps is an agentic journey map that keeps the traveler's intent attached to the route. It can compare route timing during an active journey, but it does not decide whether a place is safe, provide turn-by-turn navigation, monitor a user outside an active journey, or automatically contact emergency services.

## Core journey

1. The traveler pins a destination and can begin planning immediately. They may then add a travel mode, a free-form route brief, an expected-arrival time, an update threshold, and trusted contacts. The brief is encrypted as private journey data.
2. The iOS app asks for location access only when the traveler starts the journey.
3. Starting a journey requires the traveler to have a profile phone number. The API creates one high-entropy, encrypted, expiring invitation per chosen contact and queues the selected SMS/email channels. A recipient opens the universal link, authenticates with Apple, Google, or email, and binds the invitation to one account.
4. The app sends precise journey locations and check-ins to the private API only while a journey is active. Locations expire after the configured retention window; accepted viewers receive only a coarse area label.
5. When route updates are enabled, the same worker asks Google Routes for a fresh duration no more than once every five minutes and compares the estimated arrival with the last acknowledged baseline.
6. A delay must exceed the traveler-selected threshold before the route agent sends a push; calls require separate consent and have a 45-minute cooldown. Routine GPS movement and small ETA jitter do not call the traveler.
7. A separate deterministic worker path evaluates overdue check-ins using server timestamps and idempotency keys.
8. Escalation stage one sends a push reminder to the traveler. If the traveler explicitly enabled wellness calls, stage two calls the traveler. After the grace period, stage three notifies only approved safety-circle contacts using that recipient’s private invitation URL.
9. Any check-in or journey end cancels pending escalation stages without cancelling an undelivered initial share invitation. Route-agent calls are informational and cannot initiate contact or emergency actions. Manual contact alerts live only in the active-journey surface.

## Agentic route planning

```text
Traveler brief + origin/destination labels
  -> LLM structured intent compiler
     hard via places + objective + criteria + detour budget + soft map queries
  -> Apple MapKit
     resolve hard places, validate soft ideas, calculate legal route alternatives
  -> LLM evidence judge
     score only supplied MapKit routes and recommend one candidate
  -> deterministic policy
     enforce hard places, candidate identity, and detour budget
  -> iOS route chooser
     show three selectable routes and persist the user's choice
```

Hard waypoints such as “through Fremont” must be grounded in the traveler’s exact text and appear in every candidate. Soft ideas can be proposed by the model for any objective—scenic, quiet, coffee-friendly, low-transfer, or another request—but they become candidate evidence only after MapKit resolves them. MapKit owns place resolution, route geometry, time, distance, advisories, and route steps. The model sees only candidate IDs and that calculated evidence; it cannot return coordinates or directions. Low-scoring recommendations are presented honestly as “Best available” instead of receiving an unsupported objective label.

## System diagram

```text
Expo iOS app
  |  HTTPS + short-lived access token
  v
Fastify API on EC2  <---->  PostgreSQL on encrypted EBS
  |                         users, social identities, sessions,
  |                         contacts, invites, journeys, locations, events
  |
  +--> Expo Push API
  +--> Google Routes API (optional route snapshots)
  +--> OpenAI or OpenRouter (structured intent + evidence-only route ranking)
  +--> AWS SES email
  +--> Vapi or Twilio wellness call (optional)
  +--> Twilio SMS (optional)
  |
  +--> scheduled escalation worker

Caddy terminates TLS and proxies `/v1`, `/health`, the Apple association document, invitation landing pages, and legacy `/s/:token` status pages.
Nightly encrypted PostgreSQL backups are uploaded to a private versioned S3 bucket.
```

## Why this backend stays simple

- One stateless TypeScript service runs both the HTTP API and a single-worker escalation loop.
- PostgreSQL is the only required stateful dependency.
- Routes, push, email, SMS, and voice are adapters. Route monitoring is disabled unless explicitly configured; missing notification providers degrade to recorded development events rather than blocking the app.
- OpenAI or OpenRouter maps varied route-brief wording into a validated objective and ranks only real MapKit candidates. No LLM is in the safety path; escalation timing, recipients, and delivery authorization remain deterministic.
- The single-EC2 topology is inexpensive and understandable. The API container can later move behind an ALB and the database to RDS without changing the mobile contract.

## Authentication

- Passwords are hashed with Node's scrypt using a unique 16-byte salt.
- Access tokens are short lived and signed with a dedicated high-entropy HMAC secret that is never shared with the mobile app.
- Refresh tokens are random, stored only as SHA-256 hashes, rotated on every use, and grouped into revocable sessions.
- Email verification and recovery codes are one-time, hashed, rate-limited, and expire after 15 minutes.
- Sign-in accepts username or email. Username recovery sends the username to the verified email address.
- Apple and Google ID tokens are verified on the server against provider signing keys, issuer, expiry, and an allowlist of OAuth audiences. Social identities use the provider subject, never an unverified client user ID.
- Account deletion requires the current password for password accounts; authenticated social-only accounts use the explicit in-app `DELETE` confirmation. Deletion removes active sessions and owned/accepted share records immediately.

## Data minimization

- Background location is active only during an explicitly started journey.
- Account-gated shared-journey responses show timing, check-in state, agent updates, and a coarse area label; they never expose raw latitude/longitude, notes, agent instructions, contact details, or traveler controls.
- API logs exclude tokens, recovery codes, contact details, notes, and precise coordinates.
- Location rows expire after 30 days by default; notification events after 90 days; aggregate journey metadata remains until deletion.
- A safety contact does not need an account when added, but must create or sign into one to view a shared commute. Each invitation binds to at most one recipient account and can be revoked by its sender.
- When AI routing is enabled, the intent pass receives the route brief plus origin/destination labels and travel mode. The ranking pass receives the brief, structured objective, and MapKit candidate evidence. Contacts, precise coordinates, private notes, and safety actions are excluded.

## Reliability and abuse controls

- Every escalation action has a unique `(journey_id, stage, recipient_id)` idempotency key.
- The worker uses PostgreSQL row locks with `SKIP LOCKED` so retries cannot duplicate calls or messages.
- Rate limits protect sign-in, verification, recovery, public status, and alert endpoints.
- A server-side journey state machine rejects impossible transitions.
- Provider failures are recorded and retried with bounded exponential backoff.
- Route updates use a traveler-chosen delay threshold, an update baseline that resets after notification, and a 45-minute voice-call cooldown. Google/provider failures never enter the missed-check-in escalation path.
- Health endpoints distinguish liveness from database readiness.

## AWS deployment target

Initial production footprint:

- One ARM64 Ubuntu EC2 instance (`t4g.small` recommended) in a dedicated VPC.
- No public SSH; administration through AWS Systems Manager Session Manager.
- Public ports 80/443 only. Caddy obtains and renews TLS after DNS is pointed at the Elastic IP.
- 30-50 GB encrypted gp3 EBS.
- Private, versioned, encrypted S3 backup bucket with lifecycle expiration.
- IAM instance role limited to SSM, CloudWatch, backup bucket access, and SES send.
- CloudWatch alarms for instance status and sustained CPU. The deployment command performs an API readiness check; disk and memory alarms are a follow-up once CloudWatch Agent metrics are enabled.

Before provisioning, create or select a dedicated AWS CLI profile for the correct account and verify its account ID with STS. Never reuse the Enweave default profile.
