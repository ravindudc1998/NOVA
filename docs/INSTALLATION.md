# Installation

This development configuration is for Linux with Docker Engine, the Compose plugin and Python 3. Use a server LAN IP that is actually assigned to the machine. The existing configuration uses that value for both public application URLs and port binding; a public DNS name needs the deployment adaptation described below.

## Build and start

Clone or download the repository, open its `nova-platform/` directory and run:

```sh
python3 scripts/prepare-server.py YOUR_SERVER_LAN_IP
docker compose build api gateway media-worker media-health
docker compose up -d --no-build
docker compose ps --all
```

Replace `YOUR_SERVER_LAN_IP` before running. The setup script creates local secret files and `.env` only when absent. Initialization runs migrations, seeds the initial roles/settings and configures local identity. Existing passwords, memberships and stream keys are preserved when setup is repeated. Initial builds need internet access for pinned dependencies and images.

Open `https://YOUR_SERVER_LAN_IP/home`. The local HTTPS certificate must be trusted on each client before normal use:

```sh
docker compose cp gateway:/data/caddy/pki/authorities/local/root.crt ./nova-local-ca.crt
chmod 644 ./nova-local-ca.crt
```

Transfer this public CA certificate through your authenticated server connection and install it using the client operating system's trusted-root procedure. The CA's private key stays in the Caddy volume. No automatic client trust-store change is made by these commands.

The initial application administrator is `nova_admin`. Retrieve its generated password privately from `.secrets/first_admin_password` on your own server. First login requires a new password. The Linux/SSH login is a separate account; no fixed server password is included.

Use Administration to configure guest viewing, creator policy, chat and categories. Fresh installations start with guest video access disabled. A creator receives a channel and publishing settings automatically. In Studio, open the OBS setup dialog, configure OBS with the displayed server/key, add video/audio sources and start broadcasting. Start with 720p/30 fps, H.264/AAC and a two-second keyframe interval; advertised viewer qualities depend on the source.

## Persistent operation

After building, start existing images with:

```sh
docker compose up -d --no-build --pull never
```

Named volumes retain databases, identity state, local CA material and bounded live media. `docker compose down` keeps named volumes; `down -v` removes them. Keep required secret files with a protected backup: database copies alone do not recover encrypted credentials or local HTTPS trust. Automated recovery tooling is not included in this release.

## Local development

Node.js 24 is used by the Docker build. With Node and a configured development environment:

```sh
npm ci
npm run db:generate
npm run build:api
npm run check:web
npm run build:web
```

Run commands inside `nova-platform/`. Host API development requires local database/identity environment configuration; Compose loads secrets from its private mounts.

## Public internet hosting

The supplied LAN configuration is not an internet deployment preset. Before using a public domain, separate hostname from bind address, configure public HTTPS and identity origins/callbacks, and choose protected public ingest. Plan server resources and bandwidth for your intended audience. Keep internal database/management/media-control interfaces private. A VPS/domain is not included in this source release.

See [architecture](ARCHITECTURE.md) and [third-party notices](THIRD-PARTY-NOTICES.md).
