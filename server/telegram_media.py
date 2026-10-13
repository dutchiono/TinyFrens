"""Render verified TinyFrens companion frames as a Telegram-ready animated GIF."""
import base64
import io
import re
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw


def _number(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _color(value, opacity=1):
    if not value or value == 'none':
        return None
    if re.fullmatch(r'#[0-9a-fA-F]{3}', value):
        value = '#' + ''.join(ch * 2 for ch in value[1:])
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
        raise ValueError('Unsupported SVG color')
    rgb = tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
    return (*rgb, max(0, min(255, round(255 * opacity))))


def _translate(value):
    if not value:
        return 0, 0
    match = re.fullmatch(r'translate\(\s*(-?[0-9.]+)(?:[ ,]+(-?[0-9.]+))?\s*\)', value)
    if not match:
        raise ValueError('Unsupported SVG transform')
    return _number(match.group(1)), _number(match.group(2))


def _path_points(value):
    tokens = re.findall(r'[MmHhVvLlZz]|-?(?:\d+(?:\.\d*)?|\.\d+)', value or '')
    points, polygons, x, y, command, index = [], [], 0.0, 0.0, None, 0
    while index < len(tokens):
        token = tokens[index]
        if token.isalpha():
            command = token; index += 1
            if command in 'Zz':
                if points: polygons.append(points); points = []
                continue
        if command in ('M', 'L', 'm', 'l'):
            nx, ny = float(tokens[index]), float(tokens[index + 1]); index += 2
            if command.islower(): nx, ny = x + nx, y + ny
            x, y = nx, ny; points.append((x, y)); command = 'l' if command == 'm' else 'L' if command == 'M' else command
        elif command in ('H', 'h'):
            nx = float(tokens[index]); index += 1; x = x + nx if command == 'h' else nx; points.append((x, y))
        elif command in ('V', 'v'):
            ny = float(tokens[index]); index += 1; y = y + ny if command == 'v' else ny; points.append((x, y))
        else:
            raise ValueError('Unsupported SVG path')
    if points: polygons.append(points)
    return polygons


def _svg_frame(raw, size=128):
    if len(raw) > 150_000 or b'<!' in raw:
        raise ValueError('Invalid SVG frame')
    root = ET.fromstring(raw)
    view = [_number(value) for value in str(root.get('viewBox', '')).split()]
    if len(view) != 4 or view[2] <= 0 or view[3] <= 0:
        raise ValueError('SVG frame has no viewBox')
    left, top, width, height = view
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    scale = min(size / width, size / height)
    pad_x, pad_y = (size - width * scale) / 2, (size - height * scale) / 2
    def point(x, y, dx, dy): return ((x + dx - left) * scale + pad_x, (y + dy - top) * scale + pad_y)
    def visit(node, dx=0, dy=0, inherited_opacity=1):
        tx, ty = _translate(node.get('transform')); dx += tx; dy += ty
        opacity = inherited_opacity * _number(node.get('opacity'), 1)
        tag = node.tag.split('}')[-1]
        fill = _color(node.get('fill'), opacity) if node.get('fill') else None
        if tag == 'rect' and fill:
            x, y, w, h = map(_number, (node.get('x'), node.get('y'), node.get('width'), node.get('height')))
            draw.rectangle((*point(x, y, dx, dy), *point(x + w, y + h, dx, dy)), fill=fill)
        elif tag == 'path' and fill:
            for polygon in _path_points(node.get('d')):
                draw.polygon([point(x, y, dx, dy) for x, y in polygon], fill=fill)
        elif tag not in ('svg', 'g'):
            raise ValueError('Unsupported SVG element')
        for child in node:
            visit(child, dx, dy, opacity)
    visit(root)
    return image


def _frame(value):
    if value.startswith('data:image/png;base64,'):
        image = Image.open(io.BytesIO(base64.b64decode(value.split(',', 1)[1], validate=True))).convert('RGBA')
        image.thumbnail((128, 128), Image.Resampling.NEAREST)
        canvas = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
        canvas.alpha_composite(image, ((128 - image.width) // 2, (128 - image.height) // 2))
        return canvas
    if value.startswith('data:image/svg+xml;base64,'):
        return _svg_frame(base64.b64decode(value.split(',', 1)[1], validate=True))
    raise ValueError('Unsupported companion frame')


def companion_gif(rig):
    frames = rig.get('frames') if isinstance(rig, dict) else None
    if not isinstance(frames, list) or not 2 <= len(frames) <= 12:
        raise ValueError('Companion animation is unavailable')
    images = [_frame(frame) for frame in frames]
    duration = max(80, min(500, int(rig.get('frameMs') or 160)))
    output = io.BytesIO()
    images[0].save(output, format='GIF', save_all=True, append_images=images[1:], duration=duration,
                   loop=0, disposal=2, transparency=0, optimize=False)
    if output.tell() > 10_000_000:
        raise ValueError('Companion animation is too large for Telegram')
    return output.getvalue()
