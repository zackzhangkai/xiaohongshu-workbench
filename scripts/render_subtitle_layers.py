import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1])
config = json.loads((root / 'render.json').read_text())
width, height = config['width'], config['height']
duration = config['duration']
font_size = max(12, round(config['fontSize'] * width / 640))
font = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', font_size)
stroke = max(1, round(font_size / 16))
points = sorted(set([0, duration] + [max(0, min(duration, c[k])) for c in config['cues'] for k in ['start', 'end']]))
manifest = []
for index, start in enumerate(points):
    end = points[index + 1] if index + 1 < len(points) else duration + 0.1
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    lines = []
    for cue in config['cues']:
        if cue['start'] <= start < cue['end'] and start < duration:
            for paragraph in cue['text'].split('\n'):
                current = ''
                for char in paragraph:
                    if current and draw.textlength(current + char, font=font) > width * 0.88:
                        lines.append(current)
                        current = ''
                    current += char
                lines.append(current)
    line_height = round(font_size * 1.35)
    y = height - round(height * 0.12) - len(lines) * line_height
    if y < 0:
        raise ValueError('字幕内容过多，超出画面，请拆分字幕或减小字号')
    for line in lines:
        x = (width - draw.textlength(line, font=font)) / 2
        draw.text((x, y), line, font=font, fill=config['color'], stroke_width=stroke, stroke_fill='black')
        y += line_height
    name = f'layer-{index:05}.png'
    image.save(root / name)
    manifest.extend([f"file '{name}'", 'option framerate 1000', f'duration {end - start:.6f}'])
manifest.append(f"file '{name}'")
(root / 'layers.txt').write_text('\n'.join(manifest) + '\n')
