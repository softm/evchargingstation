import json
import tempfile
import unittest
from pathlib import Path
from scripts.record_collection_attempt import record


class CollectionAttemptTest(unittest.TestCase):
    def test_error_report_never_contains_raw_response_or_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            error = root / 'error.json'
            output = root / 'public.json'
            error.write_text(json.dumps({'code': 'NETWORK_ERROR', 'message': 'serviceKey=PRIVATE_SECRET'}))
            report = record(output, 'failure', error)
            self.assertEqual(report['status'], 'error')
            self.assertEqual(report['code'], 'NETWORK_ERROR')
            self.assertNotIn('PRIVATE_SECRET', output.read_text())
            before = output.read_text()
            self.assertIsNone(record(output, 'skipped', error))
            self.assertEqual(output.read_text(), before)
            self.assertEqual(record(output, 'success', error)['status'], 'success')
