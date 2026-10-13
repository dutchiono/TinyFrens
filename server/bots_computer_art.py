"""Rig the official 320px Bots Computer SVG with retro CRT blinking eyes and pulsing mouths."""
import base64
import copy
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])


def companion(image):
    if not isinstance(image, str):
        return None
    try:
        if image.startswith('data:image/svg+xml;base64,'):
            raw = base64.b64decode(image.split(',', 1)[1], validate=True)
        elif image.startswith('<svg'):
            raw = image.encode('utf-8')
        else:
            return None

        if len(raw) > 150_000 or b'<!' in raw or b'<script' in raw:
            return None

        root = ET.fromstring(raw)
        if root.tag != NS + 'svg' or root.get('viewBox') != '0 0 320 320':
            return None

        nodes = list(root)
        # Filter out background gradient definition and 320x320 backdrop rect
        character = [
            n for n in nodes
            if not (n.tag == NS + 'defs' or
                    (n.tag == NS + 'rect' and n.get('width') == '320' and n.get('height') == '320'))
        ]

        # Landmark validation: must contain outer monitor (x=55, y=75) and screen tube (x=75, y=95)
        has_chassis = any(n.tag == NS + 'rect' and n.get('x') == '55' and n.get('y') == '75' for n in character)
        has_screen = any(n.tag == NS + 'rect' and n.get('x') == '75' and n.get('y') == '95' for n in character)
        if not (has_chassis and has_screen):
            return None
        allowed_tags = {'rect', 'circle', 'ellipse', 'polygon', 'path', 'g', 'line'}
        allowed_attributes = {'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'd',
                              'points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform',
                              'x1', 'y1', 'x2', 'y2', 'stroke-linecap', 'stroke-linejoin'}
        if any(node.tag not in {NS + tag for tag in allowed_tags} or
               any(attribute not in allowed_attributes for attribute in node.attrib)
               for drawing in character for node in drawing.iter()):
            return None

        # Verify eye landmarks exist (2 rects around y=140 with width=25, height=25)
        eyes = [
            n for n in character
            if n.tag == NS + 'rect' and n.get('width') == '25' and n.get('height') == '25' and n.get('y') == '140'
        ]
        if len(eyes) < 2:
            return None

        # 6-phase animation cycle:
        # Phase 0: Calm idle (eyes wide open, steady green LED)
        # Phase 1: Talk / pulse (mouth active, red LED disk blip)
        # Phase 2: Steady
        # Phase 3: Steady (minor LED shift)
        # Phase 4: Blink! (eyes squash into 3px scanline slits)
        # Phase 5: Re-open settle
        frames = []
        for phase in range(6):
            frame = ET.Element(
                NS + 'svg',
                {'viewBox': '0 0 320 320', 'width': '128', 'height': '128', 'shape-rendering': 'crispEdges'}
            )
            for original in character:
                n = copy.deepcopy(original)
                tag = n.tag.split('}')[-1]

                # Eyes: blink closed on phase 4
                if tag == 'rect' and n.get('width') == '25' and n.get('height') == '25' and n.get('y') == '140':
                    if phase == 4:
                        n.set('y', '151')
                        n.set('height', '3')

                # Status LEDs on bezel
                elif tag == 'circle' and n.get('cy') == '253':
                    cx = n.get('cx')
                    if cx == '230':  # Green power LED
                        n.set('fill', '#81c784' if phase in (1, 4) else '#4caf50')
                    elif cx == '245':  # Red drive LED
                        n.set('fill', '#ff5252' if phase in (1, 3) else '#3a1111')

                # Mouth: animate on phase 1
                elif phase == 1:
                    if tag == 'circle' and n.get('cy') == '200':
                        # Expand 'O' mouth slightly
                        n.set('r', '17')
                        n.set('stroke-width', '7')
                    elif tag == 'path' and any(pos in n.get('d', '') for pos in ('195', '200', '205')):
                        # Thicken / emphasize mouth curve
                        orig_w = int(n.get('stroke-width', '7'))
                        n.set('stroke-width', str(orig_w + 3))

                frame.append(n)

            encoded = 'data:image/svg+xml;base64,' + base64.b64encode(ET.tostring(frame)).decode('ascii')
            frames.append(encoded)

        return {
            'adapter': 'bots-computers-v1',
            'frames': frames,
            'frameMs': 220,
            'idle': frames[0]
        }
    except (ValueError, StopIteration, ET.ParseError):
        return None


def with_companion(payload):
    return {**payload, 'companion': companion(payload.get('image')) if payload.get('active') else None}
