import copy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import tempfile
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

spec = importlib.util.spec_from_file_location('steel_agent', Path(__file__).with_name('steel-agent.py'))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class CandidateClientTests(unittest.TestCase):
    def setUp(self):
        source = 'fn café(x) = x;\n'
        self.value = dict(schema='steel-verified-candidate/1', run_id='fixture-run', verification_step_id='verify',
            source=source, source_sha256=hashlib.sha256(source.encode()).hexdigest(), source_bytes=len(source.encode()),
            scope={'definition_sha256': 'a'*64, 'repository': {'sha256': 'b'*64}},
            publication_authority=False, deployment_authority=False)
        self.value['artifact_sha256'] = hashlib.sha256(json.dumps(self.value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        self.args = SimpleNamespace(run_id='fixture-run', step='verify', source_sha256=self.value['source_sha256'],
            definition_sha256='a'*64, repository_sha256='b'*64)

    def test_unicode_exact_bytes_and_envelope(self):
        self.assertEqual(client.verify_candidate(self.value, self.args), self.value)

    def test_rejects_corruption_and_authority(self):
        for field, value in [('source', 'different'), ('source_bytes', 0), ('artifact_sha256', '0'*64),
                             ('run_id', 'other'), ('verification_step_id', 'other'), ('deployment_authority', True),
                             ('publication_authority', True)]:
            damaged = copy.deepcopy(self.value)
            damaged[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                client.verify_candidate(damaged, self.args)

    def test_rejects_wrong_expected_definition_and_repository(self):
        for field in ['definition_sha256', 'repository_sha256', 'source_sha256']:
            args = copy.copy(self.args)
            setattr(args, field, '0'*64)
            with self.subTest(field=field), self.assertRaises(ValueError):
                client.verify_candidate(self.value, args)

    def test_export_exact_bytes_repeat_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            self.args.export_root = Path(directory)
            result = client.export_candidate(self.value, self.args)
            target = Path(result['directory'])
            self.assertFalse(result['executed'])
            self.assertFalse(result['reused'])
            self.assertEqual((target/'candidate.txt').read_bytes(), self.value['source'].encode())
            self.assertEqual(json.loads((target/'manifest.json').read_bytes()), self.value)
            self.assertTrue(client.export_candidate(self.value, self.args)['reused'])
            (target/'candidate.txt').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                client.export_candidate(self.value, self.args)
            self.assertEqual((target/'candidate.txt').read_bytes(), b'changed')

    def test_invalid_identity_never_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            self.args.export_root = Path(directory)
            self.args.source_sha256 = '0'*64
            with self.assertRaises(ValueError):
                client.export_candidate(self.value, self.args)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_partial_directory_rejected_and_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            self.args.export_root = Path(directory)
            target = Path(directory)/self.value['artifact_sha256']
            target.mkdir()
            with self.assertRaises(ValueError):
                client.export_candidate(self.value, self.args)
            self.assertTrue(target.is_dir())
            self.assertEqual(list(target.iterdir()), [])

    def test_relative_missing_and_linked_roots_rejected(self):
        for root in [Path('relative'), Path(tempfile.gettempdir())/'steel-missing-fixture-root']:
            self.args.export_root = root
            with self.assertRaises((ValueError, OSError)):
                client.export_candidate(self.value, self.args)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            actual = root/'actual'; actual.mkdir()
            link = root/'link'
            if os.name == 'nt':
                subprocess.run(['cmd.exe','/c','mklink','/J',str(link),str(actual)],check=True,capture_output=True)
            else:
                link.symlink_to(actual, target_is_directory=True)
            try:
                self.args.export_root = link
                with self.assertRaises(ValueError):
                    client.export_candidate(self.value, self.args)
                self.assertEqual(list(actual.iterdir()), [])
            finally:
                if os.name == 'nt': link.rmdir()
                else: link.unlink()

    def test_cli_authenticated_http_to_private_export(self):
        packet = json.dumps(self.value).encode()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get('Authorization') != 'Bearer fixture-agent' or self.path != '/api/agent/v1/runs/fixture-run/candidates/verify':
                    self.send_error(403); return
                self.send_response(200); self.end_headers(); self.wfile.write(packet)
            def log_message(self, *_): pass
        server = HTTPServer(('127.0.0.1',0), Handler)
        thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                env = dict(os.environ, STEEL_AGENT_URL=f'http://127.0.0.1:{server.server_port}', STEEL_AGENT_KEY='fixture-agent')
                command = [sys.executable,'-B',str(Path(client.__file__)),'candidate','--run-id','fixture-run','--step','verify',
                    '--source-sha256',self.args.source_sha256,'--definition-sha256',self.args.definition_sha256,
                    '--repository-sha256',self.args.repository_sha256,'--export-root',directory]
                result = subprocess.run(command,env=env,capture_output=True,text=True,timeout=10,check=True)
                summary = json.loads(result.stdout)
                self.assertEqual(Path(summary['source_file']).read_bytes(),self.value['source'].encode())
                self.assertNotIn('fixture-agent',result.stdout)
                self.assertFalse(summary['executed'])
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
