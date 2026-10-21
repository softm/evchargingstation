"""Exit zero only when a code-only push can safely reuse recent status data."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def can_reuse(path, now=None):
    try:
        manifest = json.loads(path.read_text())
        raw = manifest.get('statusCoverageAt')
        if not isinstance(raw, str):
            return False
        coverage = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        current = now or datetime.now(timezone.utc)
        age = (current - coverage).total_seconds()
        return bool(manifest.get('generatedAt') and manifest.get('totalStations', 0) > 0
                    and manifest.get('regions') and 0 <= age <= 300
                    and all((path.parent / item['path']).is_file() for item in manifest['regions']))
    except (OSError, ValueError, KeyError, TypeError):
        return False


if __name__ == '__main__':
    sys.exit(0 if can_reuse(Path(sys.argv[1])) else 1)
