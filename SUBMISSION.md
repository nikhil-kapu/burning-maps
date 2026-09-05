# Burning Maps — submission kit

## Form-ready project description

### Name

Burning Maps

### Intended users

Humanitarian dispatchers and field coordinators planning relief-supply missions after floods, landslides, and infrastructure failures.

### One-line pitch

When floods erase the road, Burning Maps turns timestamped field reports into safer, human-approved relief missions.

### What it does

Burning Maps compares map route candidates against official situation reports and timestamped field observations. It explains why a route was recommended or rejected, shows evidence freshness and confidence, requires a coordinator to approve dispatch, monitors responder check-ins, and replans when new evidence invalidates an active route.

The submitted Nepal scenario is an interactive training simulation. It demonstrates the product workflow without claiming that simulated route geometry or events are safe for real-world navigation.

### What we built today

We began with the pre-existing Turtle Maps mobile shell, MapKit route architecture, and journey-safety primitives. During Burning Token we created the Burning Maps disaster-response experience: a no-login Nepal mission, sourced access evidence, freshness/confidence indicators, hazard-based route rejection, explicit human approval, an interactive bridge-closure failure, fallback replanning, responder check-in, safety disclosures, and a public browser-presented mobile demo.

### Working app

https://burning-maps.vercel.app

Test steps:

1. Tap the mission prompt or **Medical resupply**.
2. Optionally open **Timing, check-ins & team options**, then tap **Build relief route**.
3. Tap **Next route** to compare the recommended, blocked, and fallback routes.
4. Return to **Safer access**, then open the IOM or Nepal Red Cross source.
5. Tap **Start selected route**.
6. Tap **Simulate access change**, then **Check in now**.

No account or private credentials are required.

### Demo post

Upload `demo-artifacts/BurningMaps-Demo.mp4` (about 27 seconds, vertical H.264) to X, tag `@nerdconf`, then paste the resulting post URL here.

### Repository

https://github.com/nikhil-kapu/burning-maps

## Challenge entries

### San Francisco judging

Submit the working public build for the separate local competition. Emphasize Shipping, usefulness, interaction quality, honest evidence boundaries, and the new work completed today.

### Deep Research · Linkup

Enter only after Linkup is actually integrated. The qualifying flow should research official disaster sources server-side, retain citations and publication timestamps, extract access constraints, and use those findings to accept or reject a route candidate. The current local demo uses manually curated public sources and must not be described as a Linkup integration.

Suggested challenge explanation after integration:

> Burning Maps uses Linkup to research official humanitarian and infrastructure updates, checks every finding against its source and timestamp, and turns verified access constraints into an actionable relief-route decision. In the demo, the research rejects a shorter route crossing a reported failed bridge and provides evidence for the recommended alternative.

### Multiplayer · Convex

Enter only after Convex synchronizes dispatcher decisions, field reports, and responder check-ins between at least two live clients.

### Workflows · Render

Enter only after a Render-hosted background process monitors source updates, retries failed research steps, detects stale evidence, and recovers or escalates without a foreground request.

### Applied AI · Nebius

Enter only after the route-selection task uses Nebius and reports a reproducible evaluation, such as blocked-route rejection and evidence-citation accuracy across labeled incident scenarios.

Do not enter Subscriptions or Fun Build for this version.

## Two-minute demo script

### 0:00–0:14 — Problem

> “After a flood or landslide, the shortest route on a normal map may no longer exist. Coordinators are combining official reports, radio updates, and stale road information while relief teams are already moving.”

### 0:14–0:28 — Product

> “Burning Maps is evidence-aware mission planning for humanitarian field teams. This Nepal training scenario is simulated and based on public IOM and Nepal Red Cross reporting.”

Show the mission, map legend, and simulation label.

### 0:28–0:52 — Evidence-aware planning

Tap the mission prompt, then **Build relief route**.

> “The system compares map-generated candidates with timestamped evidence. It recommends the ridge relay because it was recently checked and supports the vehicle. It rejects the faster river corridor because two reports mark the crossing impassable. The AI can evaluate candidates; it cannot invent road geometry.”

### 0:52–1:12 — Trust boundary

Tap **Next route** to show the rejected shortcut, return to **Safer access**, open one official source, then tap **Start selected route**.

> “Every decision keeps its source, age, and confidence visible. Burning Maps cannot dispatch on its own—a coordinator remains accountable.”

### 1:12–1:38 — Failure recovery

Tap **Simulate access change**.

> “Now a field team reports a new washout. The active route is invalidated, Burning Maps selects a longer conditional fallback, lowers confidence, and explains the tradeoff instead of silently rerouting.”

### 1:38–1:52 — Safety loop

Tap **Check in now**.

> “The responder confirms progress, and the access desk schedules the next check-in.”

### 1:52–2:00 — Close

> “When floods erase the road, Burning Maps helps teams decide what remains reachable—and shows exactly why.”

Show the public no-login demo URL or QR code.

## X post draft

> We built Burning Maps at @nerdconf: evidence-aware relief mission planning for when floods and landslides make ordinary directions dangerously stale. Inspect sources, reject blocked routes, approve dispatch, recover from a closure, and monitor check-ins. Nepal scenario is a transparent simulation. [APP LINK]
