"""Build offline profiles and passive update bundles with Python's standard library."""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import re
import sys
root = Path(__file__).resolve().parent.parent
source, dist = root / 'src', root / 'dist'
dist.mkdir(exist_ok=True)
profiles = {'base-editor': 'Base-Editor', 'editor-with-heic': 'Editor-With-HEIC'}
selected = sys.argv[1:] or list(profiles)
if any(profile not in profiles for profile in selected):
    raise SystemExit('Profiles: base-editor, editor-with-heic')
version = json.loads((root / 'package.json').read_text())['version']
template = (source / 'index.html').read_text(encoding='utf-8')
template = template.replace('<link rel="stylesheet" href="style.css" />', '<style>' + (source / 'style.css').read_text(encoding='utf-8') + '</style>')
def inline(match):
    name = match[1]
    code = re.sub(r'</script', lambda _: r'<\/script', (source / name).read_text(encoding='utf-8'), flags=re.I)
    return '<script data-source="' + name + '">\n' + code + '\n</script>'
template = re.sub(r'<script src="([^"]+)"></script>', inline, template)
for profile in selected:
    html = template
    extensions = {}
    if profile == 'editor-with-heic':
        worker = b'\n'.join((source / name).read_bytes() for name in ['config.js', 'vendor/libheif-wasm.js', 'heic-worker.js'])
        encoded = base64.b64encode(gzip.compress(worker, mtime=0)).decode('ascii')
        notice = (source / 'vendor/libheif.NOTICE').read_text(encoding='utf-8') + '\n' + (source / 'vendor/libheif.LICENSE').read_text(encoding='utf-8')
        payload = '<script>globalThis.picQuineHEICSource=' + json.dumps(encoded) + ';</script>'
        payload += '<script type="text/plain" id="picquine-heic-license">' + notice.replace('</script', '<\\/script') + '</script>'
        html = html.replace('</head>', payload + '</head>')
        extensions = {'org.picquine.heic': [1]}
    else:
        html = html.replace('.heic,.heif,', '').replace(' · HEIC', '')
    info = {'editor': {'id': 'org.picquine.editor', 'profile': profile, 'version': version,
                      'build': hashlib.sha256((profile + html).encode()).hexdigest()},
            'compatibility': {'projectVersions': [3], 'extensions': extensions}}
    identity = json.dumps(info, separators=(',', ':'))
    html = html.replace('</head>', '<script type="application/json" id="picquine-editor-info">' + identity + '</script></head>')
    raw = html.encode('utf-8')
    (dist / (profiles[profile] + '.html')).write_bytes(raw)
    bundle = {'format': 'picquine-editor-bundle', 'version': 1, **info,
              'payload': {'encoding': 'gzip+base64', 'sha256': hashlib.sha256(raw).hexdigest(),
                          'base64': base64.b64encode(gzip.compress(raw, mtime=0)).decode('ascii')}}
    (dist / (profile + '.bundle.json')).write_text(json.dumps(bundle, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Built {profile}: {len(raw)} HTML bytes, with passive JSON update bundle.')
