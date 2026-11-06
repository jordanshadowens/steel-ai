"""Invoke real, published Steel account workflows. No model dependency."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_candidate(value, args):
    if not isinstance(value, dict):
        raise ValueError('Invalid candidate')
    source = value.get('source')
    if not isinstance(value.get('scope'), dict) or (args.repository_sha256 and not isinstance(value['scope'].get('repository'), dict)):
        raise ValueError('Invalid scope')
    if (value.get('schema') != 'steel-verified-candidate/1' or not isinstance(source, str)
        or value.get('run_id') != args.run_id or value.get('verification_step_id') != args.step
        or value.get('source_sha256') != args.source_sha256
        or value.get('scope', {}).get('definition_sha256') != args.definition_sha256
        or value.get('publication_authority') is not False or value.get('deployment_authority') is not False):
        raise ValueError('Candidate identity mismatch')
    encoded = source.encode('utf-8')
    if len(encoded) > 16384 or value.get('source_bytes') != len(encoded) or hashlib.sha256(encoded).hexdigest() != args.source_sha256:
        raise ValueError('Candidate bytes mismatch')
    if args.repository_sha256 and value.get('scope', {}).get('repository', {}).get('sha256') != args.repository_sha256:
        raise ValueError('Repository identity mismatch')
    envelope = {k: v for k, v in value.items() if k != 'artifact_sha256'}
    digest = hashlib.sha256(json.dumps(envelope, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()
    if digest != value.get('artifact_sha256'):
        raise ValueError('Artifact checksum mismatch')
    return value


def plain_path(path):
    """Refuse links/reparse points; caller must own an unshared staging root."""
    for part in [path, *path.parents]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
            raise ValueError('Export path contains a link or reparse point')


def export_candidate(value, args):
    # Called only after authenticated retrieval, and verifies independently again.
    verify_candidate(value, args)
    root = args.export_root
    if not root.is_absolute() or '..' in root.parts or not root.is_dir():
        raise ValueError('Use an existing absolute private staging directory')
    plain_path(root)
    target = root / value['artifact_sha256']
    source = value['source'].encode('utf-8')
    manifest = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    expected = {'candidate.txt': source, 'manifest.json': manifest}

    def validate_existing():
        plain_path(target)
        if not target.is_dir() or {p.name for p in target.iterdir()} != set(expected):
            raise ValueError('Existing export differs; no overwrite permitted')
        for name, data in expected.items():
            p = target / name
            plain_path(p)
            if not p.is_file() or p.stat().st_size != len(data) or p.read_bytes() != data:
                raise ValueError('Existing export differs; no overwrite permitted')

    reused = target.exists() or target.is_symlink()
    if reused:
        validate_existing()
    else:
        scratch = Path(tempfile.mkdtemp(prefix='.steel-candidate-', dir=root))
        # No caller-controlled filenames or source execution, and no recursive cleanup.
        try:
            for name, data in expected.items():
                with (scratch / name).open('xb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
            try:
                scratch.rename(target)
            except OSError:
                if not target.exists():
                    raise
                validate_existing()
                reused = True
            validate_existing()
        finally:
            if scratch.exists():
                plain_path(scratch)
                for name in expected:
                    p = scratch / name
                    if p.exists():
                        plain_path(p)
                        p.unlink()
                scratch.rmdir()
    return {'artifact_sha256': value['artifact_sha256'], 'source_sha256': value['source_sha256'],
            'directory': str(target), 'source_file': str(target / 'candidate.txt'),
            'manifest_file': str(target / 'manifest.json'), 'reused': reused,
            'executed': False, 'publication_authority': False, 'deployment_authority': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    run = sub.add_parser('run')
    run.add_argument('--workflow', required=True)
    run.add_argument('--version', type=int, required=True)
    run.add_argument('--inputs', type=Path, required=True)
    run.add_argument('--request-id', required=True, help='Persist and reuse for retries of this exact invocation')
    get = sub.add_parser('get')
    get.add_argument('--run-id', required=True)
    candidate = sub.add_parser('candidate')
    candidate.add_argument('--run-id', required=True)
    candidate.add_argument('--step', required=True)
    candidate.add_argument('--source-sha256', required=True)
    candidate.add_argument('--definition-sha256', required=True)
    candidate.add_argument('--repository-sha256')
    candidate.add_argument('--export-root', type=Path, help='Existing private staging directory; never a working checkout. Writes a hash-named artifact directory only.')
    args = parser.parse_args()
    base = os.environ.get('STEEL_AGENT_URL', '').rstrip('/')
    token = os.environ.get('STEEL_AGENT_KEY', '')
    url = urllib.parse.urlsplit(base)
    if url.username or url.password or url.query or url.fragment or url.path not in ('', '/') or not url.hostname:
        raise ValueError('STEEL_AGENT_URL must be a runtime origin without credentials or path')
    if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('Use HTTPS, or HTTP on loopback for local development')
    if not token or any(ch.isspace() for ch in token):
        raise ValueError('Set the dedicated STEEL_AGENT_KEY through your secret environment')
    path = '/api/agent/v1/workflows'
    payload = None
    headers = {'Authorization': 'Bearer ' + token}
    if args.command == 'get':
        path = '/api/agent/v1/runs/' + urllib.parse.quote(args.run_id, safe='')
    elif args.command == 'candidate':
        path = '/api/agent/v1/runs/' + urllib.parse.quote(args.run_id, safe='') + '/candidates/' + urllib.parse.quote(args.step, safe='')
    elif args.command == 'run':
        if args.inputs.stat().st_size > 8192:
            raise ValueError('Inputs exceed 8 KB')
        inputs = json.loads(args.inputs.read_text(encoding='utf-8-sig'))
        if not isinstance(inputs, dict):
            raise ValueError('Inputs must be a JSON object')
        path += '/' + urllib.parse.quote(args.workflow, safe='') + '/versions/' + str(args.version) + '/runs'
        payload = json.dumps({'inputs': inputs}).encode()
        headers.update({'Content-Type': 'application/json', 'Idempotency-Key': args.request_id})
    request = urllib.request.Request(base + path, data=payload, headers=headers)
    # Never follow a redirect carrying the credential. No automatic submission retry.
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
            content = response.read(65537)
            if len(content) > 65536:
                raise ValueError('Response exceeds limit; inspect the run in Creator')
            value = json.loads(content)
            if args.command == 'candidate':
                value = verify_candidate(value, args)
                if args.export_root:
                    value = export_candidate(value, args)
            print(json.dumps(value))
    except urllib.error.HTTPError as error:
        print(json.dumps({'error': 'Steel request rejected', 'httpStatus': error.code,
                          'recovery': 'For an uncertain run, reuse the same request ID and inputs; never silently create a new ID.'}))
        return 1
    except (urllib.error.URLError, TimeoutError):
        print(json.dumps({'error': 'Connection failed; run outcome may be unknown',
                          'recovery': 'Retry with the same request ID and inputs, or inspect the existing run.'}))
        return 1
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        print(json.dumps({'error': 'Invalid configuration, input file or response; check the tutorial'}))
        sys.exit(1)
