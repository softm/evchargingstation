"""Publish only a bounded status code and attempt time; never raw API errors."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import re
from server.client import atomic_json


def record(output, outcome, error_file):
    if outcome not in {'success', 'failure'}:
        return None
    code = None
    if outcome == 'failure':
        try:
            source = json.loads(error_file.read_text())
            raw = source.get('code', '') if isinstance(source, dict) else ''
            code = raw if re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', raw) else 'COLLECTION_FAILED'
        except (OSError, ValueError, TypeError):
            code = 'COLLECTION_FAILED'
    report = {'schemaVersion': 1, 'status': 'success' if outcome == 'success' else 'error',
              'attemptedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'code': code}
    atomic_json(output, report)
    return report


if __name__ == '__main__':
    record(Path('public/data/collection-attempt.json'), os.environ.get('COLLECTION_OUTCOME'),
           Path('/tmp/ev-collection-error.json'))
