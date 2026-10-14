import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { hoodTurtleCompanion } from '../../src/media/hood-turtle-art.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../server/fixtures/hood-turtles');

describe('Media: Hood Turtle SVG Rigging', () => {
  test('official traits survive and feet walk without backgrounds', () => {
    for (const token of [1, 7, 100, 1339]) {
      const filePath = path.join(FIXTURES_DIR, `${token}.svg`);
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath);
      const b64 = `data:image/svg+xml;base64,${raw.toString('base64')}`;

      const rig = hoodTurtleCompanion(b64);
      assert.ok(rig, `Rigging failed for token ${token}`);
      assert.equal(rig.adapter, 'hood-turtles-v1');
      assert.equal(rig.frames.length, 4);
      assert.equal(rig.frameMs, 160);

      const parser = new DOMParser();
      const frames = rig.frames.map(f => {
        const decoded = Buffer.from(f.split(',')[1], 'base64').toString('utf-8');
        return parser.parseFromString(decoded, 'image/svg+xml');
      });

      // No background 32x32 rect
      for (const frame of frames) {
        const rects = frame.getElementsByTagName('rect');
        for (let i = 0; i < rects.length; i++) {
          assert.notEqual(rects[i].getAttribute('width'), '32');
        }
      }
    }
  });

  test('unknown art is rejected', () => {
    const emptySvg = Buffer.from('<svg/>').toString('base64');
    assert.equal(hoodTurtleCompanion(`data:image/svg+xml;base64,${emptySvg}`), null);
    assert.equal(hoodTurtleCompanion('https://example.com/art.svg'), null);
  });

  test('invalid opacity and script elements are rejected', () => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, '1339.svg'), 'utf-8');
    for (const attr of ['opacity="NaN"', 'opacity="1.5"', 'opacity="-0.1"', 'onclick="alert(1)"']) {
      const changed = raw.replace('opacity="0.7"', attr);
      const b64 = `data:image/svg+xml;base64,${Buffer.from(changed).toString('base64')}`;
      assert.equal(hoodTurtleCompanion(b64), null);
    }
  });
});
