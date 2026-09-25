from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resource_guard import ensure_resource_guard

ensure_resource_guard(int(sys.argv[1]))
print('authorized')
