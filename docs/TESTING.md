# Testing and limits

Run the focused checks from `nova-platform/`:

```sh
npm ci
npm run db:generate
npm test
python3 -m unittest discover -s tests -p load_test_runner_test.py
```

The latest development validation passed 88 focused Node/TypeScript checks and four Python load-controller checks. These cover application policies/components and load allocation/report behavior; they do not replace device/browser interaction tests.

## Operator load test

On the Linux server with the existing stack running:

```sh
python3 scripts/load-test.py --streams 5 --viewers-per-stream 100 --seconds 60 --height 720
```

This starts five temporary RTMP publishers and allocates 100 HTTP virtual viewers per channel. It verifies segment downloads/progress, writes per-worker and combined reports under `artifacts/self-test-<run-id>/`, and removes temporary publishers/accounts. Ctrl+C requests cleanup. The tool uses existing images, current HTTPS authorization and resource guards. It does not reset existing accounts, settings or stream keys.

Default workers run on the NOVA server. They bypass physical LAN transfer and client-machine scheduling. For a separate Linux load machine with Node.js 22+ and already configured SSH-key access from NOVA:

```sh
python3 scripts/load-test.py --streams 5 --viewers-per-stream 100 --seconds 60 --height 720 --client-host tester@CLIENT_HOST
```

The controller streams short-lived credentials/resources privately over SSH and copies only the required worker scripts to a private temporary client directory. This optional external transport is not independently validated in the delivered development run. Resource observations must remain fresh and client/server clocks must agree. Use `--height 360` for lower media bandwidth or `--seconds 300` for five minutes; the controller bounds stream count, viewers and duration.

## Measured development observations

| HTTP virtual-client profile | Observation |
| --- | --- |
| External, one publisher / 100 viewers, 720p | Passed; zero errors/late/missed segments; segment p95 about 185 ms. |
| External, one publisher / 250 viewers, 720p | Failed delivery deadlines/timeouts. |
| External, one publisher / 500 viewers, 360p | Failed delivery deadlines/timeouts. |
| External, four publishers / 100 total viewers, 720p | Final repeat failed deadlines. |
| Same-host, one publisher / 250 viewers, 720p | Passed short diagnostic; p95 13–14 ms. |
| Same-host, one publisher / 500 viewers, 360p | Passed short diagnostic; p95 about 8 ms. |
| Same-host operator smoke, five publishers / two viewers each | Passed 480 requests with no errors/late/missed segments. |

The five-stream/500-viewer command is prepared, but that full profile has not been run in the delivered validation. Virtual clients download bytes and advance simulated presence; they do not decode video. The measurements use synthetic 720p/30 fps sources near 2 Mbps including audio and short controlled stages. They do not certify public/WAN, higher-bitrate, 4K audience, long-duration or all-authenticated capacity. Five hundred viewers at roughly 2 Mbps require about 1 Gbps of payload before overhead.

Browser/mobile login, visible playback, sound, quality switching and interaction compatibility remain to be completed on real devices. Backup/restore validation, analytics retention and broader operations tooling remain follow-up work. See [installation](INSTALLATION.md) and [architecture](ARCHITECTURE.md).
