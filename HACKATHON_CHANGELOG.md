# Burning Maps — hackathon provenance

## Starting point

Commit `95d2c07` is the unmodified pre-hackathon snapshot of Turtle Maps copied into this repository on September 5, 2026.

That foundation already contained:

- An Expo/React Native iOS application and visual system.
- Apple MapKit search and route alternatives through a native module.
- Evidence-only route ranking: AI can rank calculated routes but cannot invent road geometry.
- Journey creation, active-route monitoring, check-ins, trusted contacts, and deterministic escalation.
- A Fastify/PostgreSQL backend and provider adapters.

These components are credited as pre-existing and are not presented as work completed during Burning Token.

## Built September 5 for Burning Token

- Repositioned the product as **Burning Maps**, humanitarian access decision support.
- Added a self-contained, no-login public demo mode that does not need Clerk or a private backend.
- Designed the Nepal flood-response mission interface.
- Added timestamped official and field evidence with explicit confidence.
- Added human approval before dispatch.
- Added route rejection when a candidate intersects a reported failed bridge.
- Added an interactive new-closure event, failure recovery, fallback-route selection, and responder check-in.
- Added clear simulation and safety labeling.
- Added a browser-accessible iOS delivery path using an Appetize simulator build.

## Safety and data disclosure

The mission, teams, route geometry, confidence values, check-ins, and closure event in the hackathon build are simulated. Public IOM and Nepal Red Cross situation reports provide context, but the prototype does not ingest live emergency feeds and must not be used for rescue or navigation.

Before operational use, Burning Maps would require authoritative hazard feeds, offline operation, role-based access, agency validation, security review, field testing, accessibility testing, and a defined incident-command approval process.
