# Security Notes

Bounce Forge can be published publicly, but the admin API must be deployed with production
settings.

## Public repository

- Do not commit `.env`, `.claude/`, browser profiles, screenshots, logs, or local save data.
- Keep `ADMIN_PASSWORD` only in the deployment environment.
- Use a long unique admin password and rotate it if it was ever shared.

## Web deployment

- Set `ADMIN_PASSWORD` on the server before enabling admin publishing.
- `ADMIN_PASSWORD` must be at least secret characters and cannot use known placeholder values.
- Set `ADMIN_COOKIE_SECURE=1` when the admin API is served only through HTTPS.
- Serve the admin API and the game from the same origin unless you add a deliberate CORS policy.
- If a trusted proxy uses different ports during development, set `ADMIN_ALLOWED_ORIGINS` explicitly.
- Keep `data/campaign-level-overrides.json` writable only by the server process.

## Current protections

- Admin sessions use random HttpOnly cookies with `SameSite=Strict`.
- HTTPS/proxy deployments can mark admin cookies `Secure`.
- Failed admin login attempts are rate-limited per client address.
- Cross-origin admin login/write/reset requests are rejected unless explicitly allowed.
- Campaign writes and reset operations require an authenticated admin session.
- API and static responses include CSP, frame, referrer, permissions, and nosniff headers.
