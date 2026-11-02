#!/usr/bin/env python3
"""Embed exact saved SHA-256 verified PV2 checkpoint JSON into the game."""
import hashlib
import json
import pathlib
import sys

SOURCE=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'frozen-strength-candidates')
OUT=pathlib.Path('src/trained-model-data.js')
MODELS={
  'trained-lr001-final':('lr001-final.json',0.001,102400,
    '0043d9fafbf5f3c10d37865943e662b17d40fd2a535775a4c62f0530dd5f4ad5'),
  'trained-lr001-peak':('lr001-peak.json',0.001,95680,
    '33e76a882466d7b4465a9e991648078b613f9e3b8a48cf5afd24973edd3a60b1'),
  'trained-lr0003-peak':('lr0003-peak.json',0.0003,95360,
    '7f0c085222bbfc7eafa899c01784034b33a93540c0989816a43210677c00cee9')
}
SHAPES={'embed':(16,11),'mix1':(16,32),'mix2':(16,32),'mix3':(16,32),
  'policy':(1,16),'pass':(1,16),'valueHidden':(16,16),'value':(3,16)}
models={}
for name,(filename,lr,games,sha) in MODELS.items():
  raw=(SOURCE/filename).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('Mismatched checkpoint: '+filename)
  model=json.loads(raw)
  m=model['metadata']
  if model['architecture']!='hex-group-pv-16-v2' or m['learningRate']!=lr or m['games']!=games or m['radii']!=[2,3,4]:
    raise ValueError('Mismatched checkpoint metadata: '+filename)
  for layer,(rows,cols) in SHAPES.items():
    item=model['layers'][layer]
    if item['rows']!=rows or item['cols']!=cols or len(item['weights'])!=rows*cols or len(item['bias'])!=rows:
      raise ValueError('Unexpected layer shape: '+filename+':'+layer)
  models[name]=model
OUT.write_text('// Exact saved PV2 weights verified against Actions artifact SHA-256.\n'
  '// Source: GitHub Actions 41409728999, frozen-strength-candidates.\n'
  'export const CHECKPOINTS='+json.dumps(models,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print('Embedded',len(models),'original trained PV2 checkpoints')
