import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('snapshot_reuse', Path(__file__).resolve().parents[1] / 'scripts/can-reuse-snapshot.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotReuseTest(unittest.TestCase):
    def test_push_reuses_only_recent_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'manifest.json'
            shard = root / '11.json'
            shard.write_text('{}')
            manifest = {'generatedAt': '2026-10-21T00:00:00Z', 'totalStations': 1,
                        'statusCoverageAt': '2026-10-20T23:59:00Z', 'regions': [{'path': '11.json'}]}
            now = datetime(2026, 10, 21, tzinfo=timezone.utc)
            path.write_text(json.dumps(manifest))
            self.assertTrue(module.can_reuse(path, now))
            for stamp in ['2026-10-20T22:00:00Z', '2026-10-21T01:00:00Z', None]:
                manifest['statusCoverageAt'] = stamp
                path.write_text(json.dumps(manifest))
                self.assertFalse(module.can_reuse(path, now))
            manifest['statusCoverageAt'] = '2026-10-20T23:59:00Z'
            path.write_text(json.dumps(manifest))
            shard.unlink()
            self.assertFalse(module.can_reuse(path, now))
