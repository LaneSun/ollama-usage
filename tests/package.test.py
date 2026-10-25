"""Check the delivery artifact, including locale domain and schema compilation."""
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

with zipfile.ZipFile('ollama-usage.zip') as archive, tempfile.TemporaryDirectory() as directory:
    names = set(archive.namelist())
    required = {'extension.js', 'prefs.js', 'usage.js', 'client.js', 'accounts.js', 'stylesheet.css', 'metadata.json'}
    assert required <= names, f'Missing runtime files: {required - names}'
    assert not any(name.startswith(('.git/', '.jj/', 'tests/')) or 'cookie.txt' in name for name in names)
    metadata = json.loads(archive.read('metadata.json'))
    domain = metadata['gettext-domain']
    assert f'locale/zh_CN/LC_MESSAGES/{domain}.mo' in names, 'Translation domain mismatch'
    archive.extractall(directory)
    subprocess.run(['glib-compile-schemas', '--strict', str(Path(directory) / 'schemas')], check=True)
    assert (Path(directory) / 'schemas/gschemas.compiled').exists()
    print('PASS: runtime modules, stylesheet, translations, schema and credential exclusion')
