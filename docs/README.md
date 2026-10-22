# NOVA

Self-hosted live streaming for communities, built with React, NestJS, PostgreSQL, Keycloak, MediaMTX, FFmpeg and Caddy. Run the application on a Linux server with Docker Compose. Runtime video, identity and chat services are hosted by you.

The supplied Docker Compose configuration runs on a trusted local network. Public internet hosting requires separate deployment configuration.

## Features

- OBS/RTMP broadcasting with local H.264/AAC processing and source-aware quality choices up to 4K/30 fps.
- Guest or signed-in viewing, Auto/manual quality controls, fullscreen, picture-in-picture and integrated chat.
- Creator Studio with stream setup, live monitor/chat, stream information and Stream Health.
- Home with recent channels, live-only discovery, categories, channel branding and live thumbnails.
- Accounts, automatic creator/channel setup, groups, permissions and administrator controls.
- Favourites, follows and persistent in-app live notifications.
- Chat moderation, channel bans/timeouts, blocked phrases and chat reports.
- Creator/platform analytics, account administration, session revocation and audit history.

Browser publishing infrastructure is retained for a separately planned browser studio. Its controls are not in the current Studio. Recordings/VOD, scheduled streams, a full operations dashboard and automated backup/recovery are future work.

## Get started

Follow [installation and local HTTPS setup](INSTALLATION.md), then review [the architecture](ARCHITECTURE.md).

Application source is in `nova-platform/`. All guides are in `docs/`. Dependencies and service images are version-pinned; internet access is needed to obtain them during installation. The configured runtime does not require a hosted identity or streaming provider.

The real application requires its backend services. Static hosting such as GitHub Pages can publish a project information site, but cannot run the complete streaming backend.

## License and dependencies

NOVA application source and the documentation in this repository use the MIT license in the repository's root `LICENSE` file. Third-party packages, services and codecs retain their own licenses; see [third-party notices](THIRD-PARTY-NOTICES.md). This source export contains no Docker image archives, dependency bundles or prototype stock artwork.

Contributions and feature suggestions are welcome. Share passwords, stream keys and session tokens only through your own private operational procedures, never in public issues.
