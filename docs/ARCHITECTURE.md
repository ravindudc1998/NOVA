# Architecture

NOVA uses a single-host Docker Compose development layout. Core services are self-hosted:

| Component | Responsibility |
| --- | --- |
| React + Vite + TypeScript | Viewer, creator and administrator interfaces, bundled locally. |
| NestJS | API, authorization, channel/account workflows, chat and notifications. |
| PostgreSQL + Prisma/pg | Durable application records and current-policy queries through a bounded shared pool. |
| Keycloak | Local registration, passwords, authentication and sessions. |
| MediaMTX | Authorized media ingest and publisher lifecycle. |
| FFmpeg media worker | Source inspection, H.264/AAC processing and the source-aware HLS ladder. |
| Media health observer | Read-only media health sampling and live thumbnail generation. |
| FFmpeg restream worker | Creator-specific external RTMP/RTMPS relays, independent retries and bounded capacity. |
| Caddy | HTTPS, frontend assets, API routing and protected live media transfer. |

## Viewing and authorization

The API issues signed playback cookies after checking the current access policy. Caddy asks the API to authorize each HLS request before serving selected files from a read-only media volume. Current channel/owner status, viewer permissions, maintenance/guest policy and session revocation are checked through one parameterized database snapshot. There is no public raw-volume route.

Most media bytes are served directly by Caddy. The first and periodic segment transfers use the API's completed-transfer verification path. Audience counting additionally requires advancing playback heartbeats and deduplicates signed-in accounts/guest browsers. Manifest requests or cookie issuance alone do not count as viewers.

## External multistreaming

Creators save their destination URL and an encrypted, write-only stream key. A separate worker polls a role-protected internal API, reads local HLS output and runs one isolated FFmpeg process per active destination. It reuses suitable H.264/AAC renditions or normalizes over-budget output for the external relay. The worker receives its own API secret, without database credentials or the encryption key. Account/channel policy and separate own/any destination permissions govern access.

The scheduler allocates a bounded number of relays by creation order; extra destinations queue. A destination failure retries independently. Prolonged API loss stops relays until policy can be checked again. Public IPv4 destinations on ports 1935/443 are validated and pinned at connection time; RTMPS verifies the original hostname. Internal/metadata addresses are refused. Provider dashboards still manage eligibility, previews, final publication, titles and chat. Each destination consumes server upload bandwidth and sometimes encoding CPU.

## Deployment boundary

The initial implementation has one API instance and one local media worker. Chat/notification SSE and audience receipt/presence state need further coordination before scaling API instances. HLS ladder creation and processing capacity depend on source codecs, dimensions, frame rate and hardware.

The configured local CA supports private development devices with explicit trust setup. Internet deployment needs its own public-address/TLS/identity/ingest configuration. All application documentation is under `docs/`; code remains under `nova-platform/`.

See [installation](INSTALLATION.md).
