import base64
import io
from pathlib import Path
import unittest

from PIL import Image

from hood_turtle_art import companion as turtle_companion
from robot_companion import companion as robot_companion
from telegram_media import companion_gif


class TelegramMediaTests(unittest.TestCase):
    def render(self, rig):
        payload = companion_gif(rig)
        self.assertLess(len(payload), 10_000_000)
        image = Image.open(io.BytesIO(payload))
        self.assertEqual(image.format, 'GIF')
        self.assertEqual(image.size, (128, 128))
        self.assertEqual(image.n_frames, len(rig['frames']))
        first = image.convert('RGBA')
        self.assertEqual(first.getpixel((0, 0))[3], 0)
        self.assertIsNotNone(first.getbbox())

    def test_robot_path_frames_render_as_animation(self):
        source = (Path(__file__).parent / 'fixtures/robots-v1/1.svg').read_bytes()
        self.render(robot_companion('data:image/svg+xml;base64,' + base64.b64encode(source).decode()))

    def test_turtle_rect_frames_render_as_animation(self):
        source = (Path(__file__).parent / 'fixtures/hood-turtles/1.svg').read_bytes()
        self.render(turtle_companion('data:image/svg+xml;base64,' + base64.b64encode(source).decode()))

    def test_png_frames_keep_pixel_dimensions(self):
        image = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
        image.putpixel((10, 10), (164, 116, 241, 255))
        stream = io.BytesIO(); image.save(stream, format='PNG')
        frame = 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()
        image.putpixel((11, 10), (164, 116, 241, 255))
        stream = io.BytesIO(); image.save(stream, format='PNG')
        second = 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()
        self.render({'frames': [frame, second], 'frameMs': 160})


if __name__ == '__main__':
    unittest.main()
