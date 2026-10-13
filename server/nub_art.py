"""Rig the official Nubs cube-face pixel art with squash-and-stretch hopping physics."""
import base64
import io
from PIL import Image


def companion(image):
    if not isinstance(image, str):
        return None
    try:
        if image.startswith('data:image/png;base64,'):
            raw = base64.b64decode(image.split(',', 1)[1], validate=True)
        elif image.startswith('data:image/'):
            raw = base64.b64decode(image.split(',', 1)[1], validate=True)
        else:
            return None

        if len(raw) > 5_000_000 or len(raw) < 100:
            return None

        with Image.open(io.BytesIO(raw)) as im:
            im = im.convert('RGBA')
            w, h = im.size
            if w < 16 or h < 16 or w > 4096 or h > 4096:
                return None

            # Standardize to 256x256 using NEAREST to preserve pixel-art sharpness
            base = im.resize((256, 256), Image.Resampling.NEAREST)

        canvas_size = (256, 256)
        base_box = 220
        # 4-phase squash and stretch hop cycle:
        # Phase 0: Normal idle stance
        # Phase 1: Squash anticipation (wider, flatter at ground)
        # Phase 2: Leap apex (taller, narrower, elevated)
        # Phase 3: Land & settle
        configs = [
            (1.0, 1.0, 0),       # Idle
            (1.08, 0.90, 0),     # Squash pre-jump
            (0.94, 1.12, -26),   # Leap stretch apex
            (1.03, 0.96, -4),    # Land settle
        ]

        frames = []
        for sx, sy, dy in configs:
            fw = int(base_box * sx)
            fh = int(base_box * sy)
            scaled = base.resize((fw, fh), Image.Resampling.NEAREST)
            frame_img = Image.new('RGBA', canvas_size, (0, 0, 0, 0))
            x = (canvas_size[0] - fw) // 2
            y = canvas_size[1] - 18 - fh + dy
            frame_img.alpha_composite(scaled, (x, y))

            buf = io.BytesIO()
            frame_img.save(buf, format='PNG', optimize=True)
            encoded = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
            frames.append(encoded)

        return {
            'adapter': 'nubs-v1',
            'frames': frames,
            'frameMs': 160,
            'idle': frames[0]
        }
    except Exception:
        return None


def with_companion(payload):
    return {**payload, 'companion': companion(payload.get('image')) if payload.get('active') else None}
