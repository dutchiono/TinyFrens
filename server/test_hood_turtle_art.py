import base64
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from hood_turtle_art import companion


class HoodTurtleArtTests(unittest.TestCase):
    def test_official_traits_survive_and_feet_walk_without_backgrounds(self):
        for token in (1, 7, 100, 1339):
            raw = (Path(__file__).parent / 'fixtures' / 'hood-turtles' / f'{token}.svg').read_bytes()
            rig = companion('data:image/svg+xml;base64,' + base64.b64encode(raw).decode())
            self.assertEqual(rig['adapter'], 'hood-turtles-v1')
            self.assertEqual(len(rig['frames']), 4)
            frames = [ET.fromstring(base64.b64decode(frame.split(',')[1])) for frame in rig['frames']]
            self.assertTrue(all(n.tag.endswith('rect') for frame in frames for n in frame))
            self.assertTrue(all(n.get('width') != '32' for frame in frames for n in frame))
            original = list(ET.fromstring(raw))
            tail = next(i for i, n in enumerate(original) if n.get('x') == '5' and n.get('y') == '18')
            self.assertEqual([dict(n.attrib) for n in frames[0]], [dict(n.attrib) for n in original[tail:]])
            # The four legs and four shoes move, while the shell and face stay faithful.
            moved = [(a, b) for a, b in zip(frames[0], frames[1]) if a.attrib != b.attrib]
            self.assertEqual(len(moved), 8)
            self.assertEqual([n.get('fill') for n in frames[0]], [n.get('fill') for n in frames[1]])

    def test_unknown_art_is_not_turned_into_an_animated_square(self):
        for raw in (b'<svg/>', b'<!DOCTYPE svg><svg/>', b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><script/></svg>'):
            self.assertIsNone(companion('data:image/svg+xml;base64,' + base64.b64encode(raw).decode()))
        self.assertIsNone(companion('https://example.com/art.svg'))

    def test_invalid_opacity_and_active_content_are_rejected(self):
        raw = (Path(__file__).parent / 'fixtures' / 'hood-turtles' / '1339.svg').read_text(encoding='utf-8-sig')
        for attribute in ('opacity="NaN"', 'opacity="1.1"', 'opacity="-0.1"', 'onclick="alert(1)"'):
            changed = raw.replace('opacity="0.7"', attribute)
            self.assertIsNone(companion('data:image/svg+xml;base64,' + base64.b64encode(changed.encode()).decode()))
