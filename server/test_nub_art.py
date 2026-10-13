import base64
from pathlib import Path
import unittest
from nub_art import companion


class NubArtTests(unittest.TestCase):
    def test_official_nubs_generate_hopping_cycle(self):
        for token in (1, 2917):
            p = Path(__file__).parent / 'fixtures' / f'nub-{token}.png'
            raw = p.read_bytes()
            rig = companion('data:image/png;base64,' + base64.b64encode(raw).decode())
            self.assertIsNotNone(rig)
            self.assertEqual(rig['adapter'], 'nubs-v1')
            self.assertEqual(len(rig['frames']), 4)
            self.assertEqual(rig['frameMs'], 160)
            self.assertTrue(rig['idle'].startswith('data:image/png;base64,'))

    def test_corrupt_or_non_image_data_fails_closed(self):
        self.assertIsNone(companion('data:image/png;base64,bm90YW5pbWFnZQ=='))
        self.assertIsNone(companion('https://example.com/nub.png'))
        self.assertIsNone(companion(12345))
