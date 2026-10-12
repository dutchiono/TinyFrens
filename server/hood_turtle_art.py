"""Rig the official 32px Hood Turtle SVG; never guess at another collection's art."""
import base64
import copy
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])


def companion(image):
    if not isinstance(image, str) or not image.startswith('data:image/svg+xml;base64,'):
        return None
    try:
        raw = base64.b64decode(image.split(',', 1)[1], validate=True)
        if len(raw) > 100_000 or b'<!' in raw:
            return None
        root = ET.fromstring(raw)
        if root.tag != NS + 'svg' or root.get('viewBox') != '0 0 32 32':
            return None
        nodes = list(root)
        # The collection draws its background first, then this exact tail landmark.
        start = next(i for i, n in enumerate(nodes) if n.tag == NS + 'rect' and
                     all(n.get(k) == v for k, v in dict(x='5', y='18', width='3', height='2').items()))
        character = nodes[start:]
        if any(n.tag != NS + 'rect' or any(k not in {'x', 'y', 'width', 'height', 'fill'} for k in n.attrib)
               for n in character):
            return None
        legs = [('7', '20'), ('12', '21'), ('17', '20'), ('21', '21')]
        if not all(any(n.get('x') == x and n.get('y') == y and n.get('height') == '4' for n in character) for x, y in legs):
            return None
        frames = []
        for phase in (0, 1, 0, -1):
            frame = ET.Element(NS + 'svg', {'viewBox': '0 0 32 32', 'width': '128', 'height': '128', 'shape-rendering': 'crispEdges'})
            for original in character:
                n = copy.deepcopy(original)
                x, y = int(n.get('x', '0')), int(n.get('y', '0'))
                # Keep shoes attached to the corresponding feet, behind the shell.
                if y >= 20 and x in (6, 7, 12, 17, 21):
                    step = phase if x in (6, 7, 21) else -phase
                    n.set('x', str(x + step))
                    n.set('y', str(y - (1 if step > 0 else 0)))
                frame.append(n)
            frames.append('data:image/svg+xml;base64,' + base64.b64encode(ET.tostring(frame)).decode())
        return {'adapter': 'hood-turtles-v1', 'frames': frames, 'frameMs': 160, 'idle': frames[0]}
    except (ValueError, StopIteration, ET.ParseError):
        return None


def with_companion(payload):
    return {**payload, 'companion': companion(payload.get('image')) if payload.get('active') else None}
