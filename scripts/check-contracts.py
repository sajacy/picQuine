"""Validate contracts, fixtures and built profiles; optional developer-only jsonschema dependency.
This developer tool validates data contracts; it does not migrate old formats.
"""
from pathlib import Path
import json,base64,zlib,struct,hashlib,gzip,copy,re,subprocess
from jsonschema import Draft202012Validator
import os
os.chdir(Path(__file__).resolve().parent.parent)
def unique(pairs):
 result={}
 for key,value in pairs:
  assert key not in result, 'Duplicate JSON key: '+key
  result[key]=value
 return result
def load(path):return json.loads(Path(path).read_text(),object_pairs_hook=unique)
schemas={p.name:load(p) for p in Path('docs/schemas').glob('*.json')}
for schema in schemas.values():Draft202012Validator.check_schema(schema)
validate=Draft202012Validator(schemas['project-v3.schema.json']).validate
heic=Draft202012Validator(schemas['heic-v1.schema.json']).validate
def references(project):
 assets=project['assets']; layers=project['composition']['layers']; ids=[layer['id'] for layer in layers]
 assert len(set(ids))==len(ids)
 assert project['composition']['selected'] is None or project['composition']['selected'] in ids
 def deps(node):
  return [ref for ext in node.get('extensions',{}).values() for ref in ext['assetRefs']]
 queue=deps(project)
 for layer in layers:
  queue += [layer['content']]+([layer['original']] if layer['original'] is not None else [])+deps(layer)
 visited=set()
 while queue:
  ref=queue.pop();assert ref in assets,'Missing asset: '+ref
  if ref in visited:continue
  visited.add(ref); queue+=deps(assets[ref])
 assert visited==set(assets),'Unreachable asset'
 for key,asset in assets.items():
  raw=base64.b64decode(asset['base64'],validate=True)
  assert base64.b64encode(raw).decode()==asset['base64']
  if asset['type'] in ['image/heic','image/heif']:
   ext=asset['extensions']['org.picquine.heic'];heic(ext)
   assert not any(layer['content']==key for layer in layers) or ext['required']
examples=[]
for path in Path('docs/examples').glob('*.json'):
 project=load(path);validate(project);references(project)
 assert json.loads(json.dumps(project))==project
 examples.append(project)
 print('PASS:',path)
required=load('docs/examples/project-v3-heic-required.json')
assert base64.b64decode(required['assets']['asset-heic-1']['base64'])==Path('tests/orange.heic').read_bytes()
optional=load('docs/examples/project-v3-heic-original.json')
png=base64.b64decode(optional['assets']['asset-png-1']['base64']);position=8;compressed=b''
while position<len(png):
 length=struct.unpack('>I',png[position:position+4])[0];kind=png[position+4:position+8];data=png[position+8:position+8+length]
 assert zlib.crc32(kind+data)&0xffffffff==struct.unpack('>I',png[position+8+length:position+12+length])[0]
 if kind==b'IDAT':compressed+=data
 position+=length+12
scan=zlib.decompress(compressed);pixels=b''.join(scan[row*65+1:(row+1)*65] for row in range(16))
assert hashlib.sha256(pixels).hexdigest()=='f090187f3ed424ed938d19e0d5d51e405d7cc6d6248a6322ae49e4ffe57629cf'
negative=copy.deepcopy(required);negative['version']=2
assert list(Draft202012Validator(schemas['project-v3.schema.json']).iter_errors(negative))
negative=copy.deepcopy(required);negative['composition']['extensions']={}
assert list(Draft202012Validator(schemas['project-v3.schema.json']).iter_errors(negative))
negative=copy.deepcopy(required);negative['assets']['asset-heic-1']['extensions']['org.picquine.heic']['data']['imageIndex']=1
assert list(Draft202012Validator(schemas['heic-v1.schema.json']).iter_errors(negative['assets']['asset-heic-1']['extensions']['org.picquine.heic']))
identity={'id':'org.picquine.editor','profile':'editor-with-heic','version':'test','build':'test-only'}
compatibility={'projectVersions':[3],'extensions':{'org.picquine.heic':[1]}}
html=('<!doctype html><script type="application/json" id="picquine-editor-info">'+json.dumps({'editor':identity,'compatibility':compatibility})+'</script><script type="application/json" id="picquine-project">null</script>').encode()
bundle={'format':'picquine-editor-bundle','version':1,'editor':identity,'compatibility':compatibility,'payload':{'encoding':'gzip+base64','sha256':hashlib.sha256(html).hexdigest(),'base64':base64.b64encode(gzip.compress(html,mtime=0)).decode()}}
Draft202012Validator(schemas['editor-bundle-v1.schema.json']).validate(bundle)
assert hashlib.sha256(gzip.decompress(base64.b64decode(bundle['payload']['base64']))).hexdigest()==bundle['payload']['sha256']
for path in list(Path('docs').rglob('*.md'))+[Path('README.md'),Path('FORMAT.md'),Path('ARCHITECTURE.md')]:
 for target in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  if '://' in target or target.startswith('#'):continue
  assert (path.parent/target.split('#')[0]).exists(),(path,target)
for name in ['Base-Editor.html','Editor-With-HEIC.html','base-editor.bundle.json','editor-with-heic.bundle.json']:
 assert subprocess.run(['git','check-ignore','--quiet','dist/'+name]).returncode==1,name
for name in ['PicQuine-Example.html','PicQuine-Example.zip']:
 assert subprocess.run(['git','check-ignore','--quiet','dist/'+name]).returncode==0,name
print('PASS: all schemas, canonical payloads, references, required/optional HEIC, unknown fork data, PNG/HEIC pixel identity, malformed structures, bundle envelope/hash, documentation links and release allowlist')

for profile, stem in [('base-editor','Base-Editor'),('editor-with-heic','Editor-With-HEIC')]:
 path=Path('dist')/(profile+'.bundle.json')
 if not path.exists(): continue
 built=load(path)
 Draft202012Validator(schemas['editor-bundle-v1.schema.json']).validate(built)
 raw=gzip.decompress(base64.b64decode(built['payload']['base64'],validate=True))
 assert hashlib.sha256(raw).hexdigest()==built['payload']['sha256']
 assert raw==Path('dist',stem+'.html').read_bytes()
 assert built['compatibility']['projectVersions']==[3]
 assert bool(built['compatibility']['extensions'])==(profile=='editor-with-heic')
 print('PASS: built profile',profile)
