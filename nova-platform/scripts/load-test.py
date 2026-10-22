#!/usr/bin/env python3
"""Operator-run NOVA load test. Python stdlib + existing Compose images only."""
import argparse
import datetime as dt
try:
    import fcntl
except ImportError:
    fcntl = None
import json
import os
from pathlib import Path
import queue
import re
import shlex
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ['docker', 'compose']


def bounded(low, high):
    def value(raw):
        number = int(raw)
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f'Choose {low}..{high}')
        return number
    return value


def options(argv=None):
    parser = argparse.ArgumentParser(description='Five test streams, 100 HTTP virtual viewers per stream; automatic cleanup.')
    parser.add_argument('--streams', type=bounded(1, 5), default=5)
    parser.add_argument('--viewers-per-stream', type=bounded(1, 100), default=100)
    parser.add_argument('--seconds', type=bounded(10, 600), default=60)
    parser.add_argument('--height', type=int, choices=[360, 480, 720], default=720)
    parser.add_argument('--workers', type=bounded(1, 4), default=2)
    parser.add_argument('--media-only', action='store_true', help='Skip per-viewer metadata/library and chat sending')
    parser.add_argument('--client-host', help='Optional separate Linux client: user@host; working SSH key and Node 22+ required')
    args = parser.parse_args(argv)
    if args.client_host and not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.client_host):
        parser.error('--client-host must be user@host (no shell options)')
    return args


def command(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True, timeout=30, **kwargs).stdout


def save(path, value):
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
    temporary.replace(path)


def read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def configured_host(root=ROOT):
    host = os.environ.get('NOVA_HOST')
    if not host:
        for line in (root / '.env').read_text(encoding='utf-8').splitlines():
            if line.strip().startswith('NOVA_HOST='):
                host = line.split('=', 1)[1].strip().strip('\"\'')
                break
    if not host or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host):
        raise RuntimeError('Set NOVA_HOST to the existing platform hostname/IP in .env')
    return host


def summarize(results, args):
    stages = [stage for result in results for stage in result.get('results', [])]
    distribution = {}
    for stage in stages:
        for item in stage.get('channelDistribution', []):
            row = distribution.setdefault(item['channelId'], dict(channelId=item['channelId'], assignedViewers=0, ticketsIssued=0, viewersWithMedia=0, viewersWithProgress=0, segments=0, errors=0))
            for field in row.keys() - {'channelId'}:
                row[field] += item[field]
    complete = len(results) == args.workers and len(stages) == args.workers and len(distribution) == args.streams
    complete = complete and all(row['assignedViewers'] == args.viewers_per_stream and row['viewersWithProgress'] == args.viewers_per_stream for row in distribution.values())
    return dict(
        passed=bool(complete and all(not result.get('stopReason') for result in results)),
        requestedStreams=args.streams, requestedViewersPerStream=args.viewers_per_stream,
        requestedTotalViewers=args.streams * args.viewers_per_stream,
        requests=sum(stage['requests'] for stage in stages), errors=sum(stage['errors'] for stage in stages),
        lateSegments=sum(stage['lateSegments'] for stage in stages), missedSegments=sum(stage['missedSegments'] for stage in stages),
        segmentP95msPerWorker=[stage.get('kinds', {}).get('segment', {}).get('p95ms') for stage in stages],
        payloadMbpsPerWorker=[stage.get('mbps') for stage in stages],
        clientEventLoopUtilizationPerWorker=[stage.get('client', {}).get('eventLoopUtilization') for stage in stages],
        clientEventLoopP95msPerWorker=[stage.get('client', {}).get('eventLoopP95ms') for stage in stages],
        channelDistribution=list(distribution.values()),
        stopReasons=[result.get('stopReason') for result in results if result.get('stopReason')])


def main(argv=None):
    args = options(argv)
    if fcntl is None:
        raise RuntimeError('Run this controller on the Ubuntu server; --client-host selects a separate Linux load machine')
    total = args.streams * args.viewers_per_stream
    args.workers = min(args.workers, total)
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:6]
    private_root = ROOT / '.load-test'
    private_root.mkdir(mode=0o700, exist_ok=True)
    lock = (private_root / 'self-test.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('Another operator load test is running')
    private = private_root / run_id
    private.mkdir(mode=0o700)
    output = ROOT / 'artifacts' / ('self-test-' + run_id)
    output.mkdir(parents=True)
    fixture_name = 'nova-load-fixture-' + run_id.lower()
    fixture = None
    fixture_log = None
    remote_directory = None
    clients = []
    events = queue.Queue()
    results = {}
    stop = threading.Event()
    failure = None
    cleanup = None
    placement = 'External Linux client over LAN' if args.client_host else 'Same Ubuntu host; bypasses physical LAN; no external capacity certification'
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', args.client_host] if args.client_host else None
    for name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(name, lambda *_: stop.set())

    def send(process, message):
        if process.poll() is None:
            try:
                process.stdin.write(json.dumps(message) + '\n')
                process.stdin.flush()
            except (BrokenPipeError, OSError):
                pass

    def collect(index, process):
        for line in process.stdout:
            events.put((index, line.rstrip()))

    try:
        host = configured_host()
        command(COMPOSE + ['version'])
        ca = command(COMPOSE + ['exec', '-T', 'gateway', 'cat', '/data/caddy/pki/authorities/local/root.crt'])
        if 'BEGIN CERTIFICATE' not in ca:
            raise RuntimeError('Local CA unavailable')
        if ssh:
            command(ssh + ['node --input-type=module -e ' + shlex.quote('if(Number(process.versions.node.split(".")[0])<22)process.exit(1)')])
            remote_directory = command(ssh + ['mktemp -d /tmp/nova-load-' + run_id + '.XXXXXX']).strip()
            if not re.fullmatch('/tmp/nova-load-' + re.escape(run_id) + r'\.[A-Za-z0-9]+', remote_directory):
                raise RuntimeError('Unexpected client workspace')
            command(['scp', '-q', '-o', 'BatchMode=yes'] + [str(ROOT / 'scripts' / name) for name in ('load-worker.mjs', 'load-client.mjs', 'load-profile.mjs')] + [args.client_host + ':' + remote_directory + '/'])
        print(f'NOVA test: {args.streams} streams x {args.viewers_per_stream} viewers = {total}; {args.height}p; {args.seconds}s', flush=True)
        print('Placement: ' + placement, flush=True)
        print('Preparing isolated test accounts and publishers...', flush=True)
        fixture_log = (output / 'fixture.log').open('w')
        fixture_args = COMPOSE + ['run', '--rm', '-T', '--no-deps', '--pull', 'never', '--user', 'root', '--name', fixture_name, '--entrypoint', 'node', '-e', f'NOVA_LOAD_STREAMS={args.streams}', '-e', f'NOVA_HOST={host}']
        for secret in ('app_db_password', 'credential_key', 'identity_admin_password'):
            fixture_args += ['-v', f'{ROOT}/.secrets/{secret}:/run/secrets/{secret}:ro']
        fixture_args += ['-v', f'{ROOT}/scripts:/app/scripts:ro', '-v', f'{private}:/load-test', 'media-health', '--import', './scripts/load-secrets.mjs', 'scripts/load-fixtures.mjs']
        fixture = subprocess.Popen(fixture_args, cwd=ROOT, stdout=fixture_log, stderr=subprocess.STDOUT, text=True)
        deadline = time.monotonic() + 150
        plan = None
        while not stop.is_set() and time.monotonic() < deadline:
            plan = read(private / 'plan.json')
            if plan:
                break
            if fixture.poll() is not None:
                raise RuntimeError('Fixture startup failed; see fixture.log')
            stop.wait(1)
        if not plan or stop.is_set():
            raise RuntimeError('Test stopped or fixture provisioning timed out')
        if plan.get('origin') != 'https://' + host or len(plan.get('channels', [])) != args.streams:
            raise RuntimeError('Fixture origin or stream count does not match the requested test')
        save(private / 'control.json', dict(streams=args.streams, phase=f'operator {args.streams}x{args.viewers_per_stream} {args.height}p'))
        for index, channel in enumerate(plan['channels'], 1):
            print(f'Stream {index}: {plan["origin"]}/channel/{channel}', flush=True)
        print('Warming live outputs (20 seconds)...', flush=True)
        stop.wait(20)
        resources = read(private / 'resources.json')
        if stop.is_set() or not resources or resources.get('guard'):
            raise RuntimeError('Test stopped or host resource guard triggered')
        for index in range(args.workers):
            if ssh:
                worker_command = ssh + ['node ' + shlex.quote(remote_directory + '/load-worker.mjs')]
            else:
                worker_command = COMPOSE + ['run', '--rm', '-T', '--no-deps', '--pull', 'never', '--name', f'nova-load-client-{run_id.lower()}-{index}', '--entrypoint', 'node', '-v', f'{ROOT}/scripts:/app/scripts:ro', 'media-health', 'scripts/load-worker.mjs']
            process = subprocess.Popen(worker_command, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            clients.append(process)
            threading.Thread(target=collect, args=(index, process), daemon=True).start()
            send(process, dict(type='config', plan=plan, ca=ca, cohort=index, cohorts=args.workers, totalViewers=total, streams=args.streams, seconds=args.seconds, height=args.height, clientLabel=placement, fullProfile=not args.media_only, resources=resources))
        print(f'Running {args.workers} workers. Ctrl+C stops clients and cleans test fixtures.', flush=True)
        deadline = time.monotonic() + args.seconds + 130
        last_sample = None
        last_status = 0
        while len(results) < args.workers:
            while not events.empty():
                index, line = events.get_nowait()
                if line.startswith('NOVA_RESULT '):
                    message = json.loads(line[len('NOVA_RESULT '):])
                    if message.get('result') is not None:
                        results[index] = message['result']
                        save(output / f'worker-{index}.json', message['result'])
                    if message.get('error'):
                        raise RuntimeError(f'Worker {index}: {message["error"]}')
                elif line:
                    with (output / f'worker-{index}.log').open('a') as log:
                        log.write(line + '\n')
            if len(results) == args.workers:
                break
            sample = read(private / 'resources.json')
            if sample and sample != last_sample:
                last_sample = sample
                for process in clients:
                    send(process, dict(type='resources', sample=sample))
                if sample.get('guard'):
                    raise RuntimeError('Host guard: ' + sample['guard'])
            if stop.is_set():
                raise RuntimeError('Interrupted by operator')
            if time.monotonic() > deadline:
                raise RuntimeError('Load worker deadline exceeded')
            for index, process in enumerate(clients):
                if process.poll() is not None and index not in results and events.empty():
                    # Allow the reader thread to publish the last stdout line.
                    time.sleep(.2)
                    if events.empty():
                        raise RuntimeError(f'Worker {index} exited without a result')
            if time.monotonic() - last_status >= 10:
                print(f'Running: {len(results)}/{args.workers} workers finished; host CPU {sample.get("cpuPercent", "?") if sample else "?"}%', flush=True)
                last_status = time.monotonic()
            time.sleep(.2)
    except Exception as error:
        failure = str(error)
        print('Test stopped: ' + failure, flush=True)
    finally:
        print('Cleaning test publishers and accounts...', flush=True)
        for process in clients:
            send(process, dict(type='stop'))
        for process in clients:
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.terminate()
        save(private / 'control.json', dict(stop=True, streams=0, phase='operator cleanup'))
        if fixture:
            try:
                fixture.wait(timeout=120)
            except subprocess.TimeoutExpired:
                failure = failure or 'Fixture cleanup timed out; inspect fixture.log and private run folder'
                try:
                    command(['docker', 'stop', '--time', '90', fixture_name])
                except Exception:
                    pass
            cleanup = read(private / 'finished.json')
        if fixture_log:
            fixture_log.close()
        if ssh and remote_directory:
            try:
                paths = ' '.join(shlex.quote(remote_directory + '/' + name) for name in ('load-worker.mjs', 'load-client.mjs', 'load-profile.mjs'))
                command(ssh + ['rm -f -- ' + paths + ' && rmdir -- ' + shlex.quote(remote_directory)])
            except Exception:
                print('Client script cleanup needs attention: ' + remote_directory, flush=True)
        for name in ('plan.json', 'plan.tmp', 'control.json', 'control.next'):
            (private / name).unlink(missing_ok=True)
        ordered = [results[index] for index in sorted(results)]
        summary = summarize(ordered, args)
        summary.update(runId=run_id, placement=placement, browserDecoding=False, infrastructureError=failure, fixtureCleanup=cleanup)
        summary['passed'] = summary['passed'] and not failure and bool(cleanup and cleanup.get('fixturesRemoved') and cleanup.get('existingPolicyAndKeysPreserved'))
        save(output / 'summary.json', summary)
        print(f'RESULT: {"PASS" if summary["passed"] else "FAIL"}; requests={summary["requests"]}, errors={summary["errors"]}, late={summary["lateSegments"]}, missed={summary["missedSegments"]}', flush=True)
        print('Segment p95 ms per worker: ' + str(summary['segmentP95msPerWorker']), flush=True)
        for index, row in enumerate(summary['channelDistribution'], 1):
            print(f'Stream {index}: assigned {row["assignedViewers"]}, received media {row["viewersWithMedia"]}, progressing {row["viewersWithProgress"]}', flush=True)
        print('Report: ' + str(output / 'summary.json'), flush=True)
        if not cleanup or not cleanup.get('fixturesRemoved'):
            print('Cleanup is NOT confirmed. Inspect ' + str(output / 'fixture.log'), flush=True)
        lock.close()
    return 0 if summary['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('Cannot start test: ' + str(error), file=sys.stderr)
        sys.exit(1)
