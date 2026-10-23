"""Generate local server secrets without printing them. Run once before Compose."""
import os
import pathlib
import secrets
import sys

root = pathlib.Path(__file__).resolve().parent.parent
private = root / '.secrets'
private.mkdir(mode=0o700, exist_ok=True)
os.chmod(private, 0o700)
for name in ['postgres_password', 'app_db_password', 'identity_db_password', 'identity_admin_password', 'first_admin_password', 'credential_key', 'media_secret', 'identity_service_secret', 'restream_service_secret']:
    target = private / name
    if not target.exists():
        value = secrets.token_hex(32) if name == 'credential_key' else secrets.token_urlsafe(30)
        target.write_text(value + '\n', encoding='utf-8')
        os.chmod(target, 0o444)
host = sys.argv[1] if len(sys.argv) > 1 else '192.168.0.191'
env = root / '.env'
if not env.exists():
    env.write_text('NOVA_HOST=' + host + '\n', encoding='utf-8')
    os.chmod(env, 0o600)
print('Local secret files and server configuration are ready; existing secrets were preserved.')
