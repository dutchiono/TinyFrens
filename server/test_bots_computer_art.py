import base64
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from bots_computer_art import companion


class BotsComputerArtTests(unittest.TestCase):
    def test_official_traits_survive_and_eyes_blink_without_background(self):
        for token in (1, 25, 38):
            raw = (Path(__file__).parent / 'fixtures' / f'bots-computer-{token}.svg').read_bytes()
            rig = companion('data:image/svg+xml;base64,' + base64.b64encode(raw).decode())
            self.assertIsNotNone(rig)
            self.assertEqual(rig['adapter'], 'bots-computers-v1')
            self.assertEqual(len(rig['frames']), 6)
            self.assertEqual(rig['frameMs'], 220)

            frames = [ET.fromstring(base64.b64decode(frame.split(',')[1])) for frame in rig['frames']]
            # No background 320x320 rect
            for f in frames:
                self.assertFalse(any(n.get('width') == '320' and n.get('height') == '320' for n in f))

            # Frame 0 vs Frame 4 (blink)
            # In frame 0, eyes are height 25. In frame 4, eyes are squashed to height 3
            f0_eyes = [n for n in frames[0] if n.get('y') == '140' and n.get('width') == '25']
            self.assertEqual(len(f0_eyes), 2)
            self.assertEqual(f0_eyes[0].get('height'), '25')

            f4_eyes = [n for n in frames[4] if n.get('width') == '25' and n.get('height') == '3']
            self.assertEqual(len(f4_eyes), 2)
            self.assertEqual(f4_eyes[0].get('y'), '151')

    def test_unknown_or_malicious_art_rejected(self):
        for raw in (b'<svg/>', b'<!DOCTYPE svg><svg/>', b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><script/></svg>'):
            self.assertIsNone(companion('data:image/svg+xml;base64,' + base64.b64encode(raw).decode()))
        self.assertIsNone(companion('https://example.com/art.svg'))
