# Burning Maps

> When floods erase the road, Burning Maps turns timestamped field reports into safer, human-approved relief missions.

Burning Maps is an evidence-aware field-operations prototype created for the Burning Token hackathon. The public demo lets a relief coordinator compare routes against sourced access reports, reject a route crossing a failed bridge, approve dispatch, recover from a newly reported closure, and confirm the responder's check-in.

The Nepal scenario is a clearly labeled training simulation based on public situation reports from [IOM](https://asiapacific.iom.int/sites/g/files/tmzbdl671/files/documents/2026-09/iom-nepal-flood-sitrep-2.pdf) and the [Nepal Red Cross Society](https://website-api.nrcs.org/media/highlights/files/Rasuwa_Situation_Update_5.pdf). It is decision-support research, not certified rescue software or live navigation.

## Try the hackathon demo

The no-login interactive web build is available at **[burning-maps.vercel.app](https://burning-maps.vercel.app)**.

The iOS build launches directly into the same public demo mode. For local development:

```bash
npm ci
EXPO_PUBLIC_BURNING_MAPS_DEMO=true npm run ios
```

The repository also produces a bundled iOS Simulator release suitable for Appetize. The web build is the primary judging URL because it is immediately accessible without an Appetize account, TestFlight, or an Apple device.

See [`SUBMISSION.md`](SUBMISSION.md) for the demo script and form-ready copy, and [`HACKATHON_CHANGELOG.md`](HACKATHON_CHANGELOG.md) for a precise separation of pre-existing and September 5 work.

## Pre-existing Turtle Maps foundation

Burning Maps starts from Turtle Maps, an iOS-first agentic journey map for solo travelers. Turtle Maps supplies the existing mobile shell, MapKit integration, route-candidate architecture, journey monitoring, and check-in primitives described below.

### Foundation product surfaces

- Low-friction authentication through Clerk: one Google button handles signup or signin, email signup needs only email and password, optional usernames remain available for signin, and age confirmation happens once after the first authenticated account creation. Terms and Privacy are readable in-app and acknowledged through concise continuation copy instead of blocking switches. Apple appears automatically after Apple Developer credentials are configured.
- Clear welcome and account setup, followed by contextual location, notification, and safety-circle guidance when those features are used.
- Map-led journey planning: destination search first, manual center-flag selection as a fallback, travel mode, an encrypted free-form route brief with ordered pass-through places such as “scenic through Fremont,” expected arrival, check-in cadence, private notes, and chosen contacts.
- Consent-based route-agent updates: thresholded route and arrival changes by push, with optional rate-limited Vapi calls that remain informational and cannot trigger contact or emergency escalation.
- Active journey: live route-agent state, last update, location permission state, next check-in, one-tap check-in, extend arrival, call-me-now, manual contact alert, account-gated invite resend, and end journey.
- Trusted journey sharing: each selected person receives a separate expiring SMS/email link, signs up or signs in, accepts once, and gets a read-only “Shared with me” view with timing, check-ins, route-agent updates, and only a coarse area.
- Safety circle: trusted contacts can be added by phone, email, or both, with per-contact delivery preferences and explicit consent guidance. The traveler must add their own phone number before starting a shared journey.
- Journey history and profile/security settings.
- Legacy coarse public-status pages remain readable for previously created links, but new in-app sharing uses per-recipient, account-bound invitations instead.

## Repository

- `mobile/` - Expo React Native iOS application.
- `backend/` - Fastify API and escalation worker.
- `infra/` - single-EC2 production deployment, Caddy TLS, PostgreSQL, backups, and AWS provisioning scripts.
- `ARCHITECTURE.md` - system design and product safety boundaries.
- `APP_STORE_CHECKLIST.md` - remaining Apple and release work.

## Local development

Prerequisites: Node.js 22+, Docker Desktop, Xcode, and an iOS Simulator.

```bash
npm install
cp backend/.env.example backend/.env.local
cp mobile/.env.example mobile/.env.local
clerk auth login
cd mobile && clerk init --app app_3IU5lwDz6LiE0TyfA8z3akxya4h && cd ..
docker compose -f infra/docker-compose.local.yml up -d db
npm run db:migrate -w backend
npm run db:seed -w backend
npm run dev:api
npm run ios -- --device "iPhone 17"
```

Clerk CLI writes the development publishable key to `mobile/.env.local`. Add the matching server-only `CLERK_SECRET_KEY` to `backend/.env.local`; never place it in the mobile app or any `EXPO_PUBLIC_*` variable. The mobile app obtains a short-lived Clerk session token, the API verifies it with Clerk, links the Clerk identity to the local Turtle Maps profile, and returns a separate rotating API session used by background journey tracking.

The local seed creates clearly synthetic data. Delivery adapters remain in console/disabled mode, and route briefs use the deterministic supported-intent parser by default, so local testing cannot send an SMS or place a real call. The active-journey screen exposes a development-only “Test a route-agent update” button; the corresponding API route is unavailable in production. Run `npm run test:e2e` while the API is running to exercise two legacy local accounts through signup, verification, invitation preview, invite acceptance, read-only shared visibility, resend, route updates, cancellation, start, check-in, end, and deletion against PostgreSQL. Clerk sign-in and the Clerk-to-API exchange are tested separately with a Clerk development user.

Route briefs have deterministic, OpenAI, and OpenRouter interpreter modes. The default deterministic mode recognizes supported constraints and explicit `via`, `through`, or `by way of` places without calling an LLM. Set `AGENT_BRIEF_MODE=openai` with a server-side `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, which defaults to `gpt-4o-mini`) to use OpenAI structured outputs. OpenRouter remains available with `AGENT_BRIEF_MODE=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL`.

In an AI mode, the backend compiles the brief into exact hard waypoints, a general route objective, ranking criteria, a detour budget, and optional soft map-search ideas. The iOS app asks Apple MapKit for alternate legal routes, validates every soft place with Maps, and returns only calculated route evidence to the backend. The model scores those real candidates; a deterministic detour guard checks the recommendation. The journey plan then presents three distinct, selectable choices such as Scenic pick, Quickest, and Shortest, with the full route visible. Starting the journey persists the selected route and its validated waypoints for later monitoring. The LLM never invents road geometry or turn-by-turn directions. OpenAI requests set `store: false`, and provider keys never enter the mobile bundle.

Google sign-in uses Clerk SSO and is enabled in the linked Clerk development instance. Apple sign-in uses Clerk SSO and stays visibly unavailable until it is enabled with the app's Apple Team ID, Services ID/client ID, Key ID, and private key. Configure `PUBLIC_BASE_URL` and the same universal-link origin in the mobile build so `/invite/:token` opens the installed app and otherwise shows the App Store handoff page. Configure Twilio for SMS and SES for email; invitation links are never returned in list APIs or exposed to the traveler’s share sheet.

The iOS app uses Apple MapKit through `react-native-maps`, so no mobile Google Maps key is required for iOS. Production route-change monitoring is server-side and remains off until `ROUTE_UPDATES_MODE=google` and a restricted `GOOGLE_ROUTES_API_KEY` are configured. Android store builds require separate Google Maps SDK configuration.

For a physical iPhone, replace `EXPO_PUBLIC_API_URL` with the Mac's LAN address and use an Expo development build. Background location does not run reliably in Expo Go.

## Production posture

The checked-in AWS scripts are inert until an explicit non-Enweave AWS profile and expected account ID are supplied. No AWS resource is created by local development or by installing dependencies.

See `infra/AWS_DEPLOYMENT.md` for the account-safe production sequence. The current repository is a launch-ready foundation, but App Store submission still requires final Apple/EAS identifiers, legal URLs, a production domain, provider accounts, and real-device background-location/push testing.
