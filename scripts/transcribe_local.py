"""Offline Whisper adapter: only an existing model directory is accepted."""
import json
import os
import sys
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import mlx_whisper

audio, model, output = sys.argv[1:]
if not Path(model).is_dir():
    raise RuntimeError('Local model is missing')
result = mlx_whisper.transcribe(audio, path_or_hf_repo=model, word_timestamps=True, verbose=False)
segments = []
for segment in result.get('segments', []):
    text = segment['text'].strip()
    start, end = float(segment['start']), float(segment['end'])
    if not text or end <= start:
        continue
    segments.append({'start': start, 'end': end, 'text': text,
                     'words': [{'word': w['word'], 'start': float(w['start']), 'end': float(w['end'])}
                               for w in segment.get('words', [])]})
Path(output).write_text(json.dumps({'text': result.get('text', '').strip(),
                                   'language': result.get('language'), 'segments': segments}, ensure_ascii=False), encoding='utf-8')
