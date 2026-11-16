import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zlib

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/flowchart/scripts/mermaid_url.py'
SPEC = importlib.util.spec_from_file_location('mermaid_url', SCRIPT)
mermaid_url = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mermaid_url)

class FlowchartTests(unittest.TestCase):
    def test_url_round_trip_preserves_unicode_and_live_state(self):
        code = 'flowchart TD\n  A[开始] --> B[完成]\n'
        url = mermaid_url.make_url(code)
        self.assertTrue(url.startswith('https://mermaid.live/edit#pako:'))
        encoded = url.split('#pako:', 1)[1]
        state = json.loads(zlib.decompress(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))))
        self.assertEqual(state['code'], code)
        self.assertEqual(json.loads(state['mermaid']), {'theme': 'default'})
        self.assertTrue(state['updateDiagram'])

    def test_cli_file_and_stdin_agree_and_empty_input_fails(self):
        code = 'flowchart LR\n  A --> B\n'
        stdin = subprocess.run([sys.executable, str(SCRIPT), '-'], input=code, text=True, capture_output=True, check=True)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / '图表.mmd'
            source.write_text(code, encoding='utf-8')
            file = subprocess.run([sys.executable, str(SCRIPT), str(source)], text=True, capture_output=True, check=True)
        self.assertEqual(stdin.stdout, file.stdout)
        empty = subprocess.run([sys.executable, str(SCRIPT), '-'], input=' ', text=True, capture_output=True)
        self.assertNotEqual(empty.returncode, 0)

if __name__ == '__main__':
    unittest.main()
