# iOS App Store release checklist

## Accounts and identifiers

- Apple Developer Program membership.
- Final bundle identifier (placeholder: `com.turtlebuddy.app`).
- App Store Connect record, SKU, age rating, category, territories, and pricing.
- Expo/EAS project ID and App Store Connect API key for automated submission.
- Sign in with Apple capability enabled for the bundle ID, Apple team ID configured on the API, and Apple client ID allowlisted.
- Google OAuth iOS client created for the final bundle ID; mobile and backend audience values match.
- Associated Domains entitlement points to the production invite domain; `/.well-known/apple-app-site-association` validates without redirects.

## Product and legal

- Public privacy policy URL and support URL.
- Terms of service accepted during signup.
- In-app account deletion verified end to end.
- App Privacy answers for contact info, precise/coarse location, identifiers, diagnostics, and user content.
- Safety copy reviewed by counsel; do not market the app as guaranteeing safety or replacing emergency services.

## iOS permissions

- Notifications are requested after value is explained.
- `When In Use` location is requested when a journey starts.
- `Always` location is requested only if continuous background tracking is enabled by the traveler.
- Background location indicator and usage descriptions match actual behavior.
- Contacts permission is not required; users enter contacts manually or use the system contact picker in a future release.

## Review evidence

- Demo account with seeded journey history and safety circle.
- Two review accounts and an invitation walkthrough showing SMS/email link, signup/signin, acceptance, “Shared with me,” read-only controls, and revocation/expiry behavior.
- Review notes explain how to start a journey, trigger a test reminder, and use the simulated provider mode.
- Video showing that location stops when a journey ends.
- Video showing no automatic emergency-service call.
- User-configured local emergency number is stored for reference only; Turtle Maps never dials it automatically.
- Restore, offline, slow-network, denied-permission, and expired-session states tested.

## Build and submit

```bash
cd mobile
npx eas login
npx eas build --platform ios --profile production
npx eas submit --platform ios --profile production
```

Do not submit until the production API domain, privacy/support URLs, Apple identifiers, screenshots, and provider configuration are final.
