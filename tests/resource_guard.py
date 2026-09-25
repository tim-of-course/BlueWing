"""Keep direct Python desktop-test invocations inside the shared heavy-job guard."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys


def ensure_resource_guard(port=47631):
    token = os.environ.get('BLUEWING_HEAVY_TOKEN')
    if token:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=2) as connection:
                connection.sendall((token + '\n').encode())
                data = b''
                while True:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                if json.loads(data).get('authorized'):
                    return
        except (OSError, ValueError):
            pass
        print('[resource guard] Parent guard is no longer valid. Restart the test.', file=sys.stderr)
        raise SystemExit(75)
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(['bun', str(root / 'scripts/heavy.ts'), '--', sys.executable, *sys.argv])
    raise SystemExit(result.returncode)
