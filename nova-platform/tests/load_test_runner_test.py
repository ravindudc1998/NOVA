import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location('load_test', Path(__file__).resolve().parents[1] / 'scripts' / 'load-test.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class OperatorRunnerTest(unittest.TestCase):
    def result(self, viewers=100, progressing=100, reason=None):
        return dict(stopReason=reason, results=[dict(
            requests=50, errors=0, lateSegments=0, missedSegments=0,
            kinds={'segment': {'p95ms': 12}},
            channelDistribution=[dict(channelId=str(i), assignedViewers=viewers, ticketsIssued=viewers,
                                      viewersWithMedia=progressing, viewersWithProgress=progressing,
                                      segments=200, errors=0) for i in range(5)])])

    def test_operator_defaults_are_five_by_one_hundred(self):
        args = runner.options([])
        self.assertEqual((args.streams, args.viewers_per_stream, args.workers), (5, 100, 2))

    def test_summary_requires_every_viewer_to_progress(self):
        args = SimpleNamespace(workers=2, streams=5, viewers_per_stream=100)
        result = runner.summarize([self.result(50, 50), self.result(50, 50)], args)
        self.assertTrue(result['passed'])
        self.assertEqual([x['assignedViewers'] for x in result['channelDistribution']], [100] * 5)
        self.assertFalse(runner.summarize([self.result(50, 49), self.result(50, 50)], args)['passed'])

    def test_missing_or_failed_worker_cannot_be_a_pass(self):
        args = SimpleNamespace(workers=2, streams=5, viewers_per_stream=100)
        self.assertFalse(runner.summarize([self.result()], args)['passed'])
        self.assertFalse(runner.summarize([self.result(50, 50, 'Interrupted'), self.result(50, 50)], args)['passed'])

    def test_fixture_host_is_loaded_from_the_project_environment(self):
        with TemporaryDirectory() as folder, patch.dict(runner.os.environ, {}, clear=True):
            root = Path(folder)
            (root / '.env').write_text('NOVA_HOST="192.168.0.191"\nOTHER_SETTING=ignored\n')
            self.assertEqual(runner.configured_host(root), '192.168.0.191')
            (root / '.env').write_text('NOVA_HOST=bad host\n')
            with self.assertRaises(RuntimeError):
                runner.configured_host(root)


if __name__ == '__main__':
    unittest.main()
