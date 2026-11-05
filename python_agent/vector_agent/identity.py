"""Identity of loaded runtime sources; excludes credentials, logs and evidence."""
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def source_identity():
    paths = [p for folder in ('server', 'shared', 'src', 'python_agent/vector_agent', 'config')
             for p in (ROOT / folder).rglob('*')
             if p.is_file() and p.suffix in ('.ts', '.py', '.json', '.css')]
    paths += [ROOT / 'index.html', ROOT / 'package.json']
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix()):
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(b'\0')
        digest.update(path.read_bytes().replace(b'\r\n', b'\n'))
    return digest.hexdigest()


SOURCE_IDENTITY = source_identity()
