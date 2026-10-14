import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { botsComputerCompanion } from '../../src/media/bots-computer-art.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../server/fixtures');

describe('Media: Bots Computer SVG Rigging', () => {
  test('official traits survive and eyes blink without background', () => {
    for (const token of [1, 25, 38]) {
      const filePath = path.join(FIXTURES_DIR, `bots-computer-${token}.svg`);
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath);
      const b64 = `data:image/svg+xml;base64,${raw.toString('base64')}`;

      const rig = botsComputerCompanion(b64);
      assert.ok(rig, `Rigging failed for Bots token ${token}`);
      assert.equal(rig.adapter, 'bots-computers-v1');
      assert.equal(rig.frames.length, 6);
      assert.equal(rig.frameMs, 220);

      const parser = new DOMParser();
      const frames = rig.frames.map(f => {
        const decoded = Buffer.from(f.split(',')[1], 'base64').toString('utf-8');
        return parser.parseFromString(decoded, 'image/svg+xml');
      });

      // No background 320x320 rect
      for (const frame of frames) {
        const rects = frame.getElementsByTagName('rect');
        for (let i = 0; i < rects.length; i++) {
          assert.notEqual(rects[i].getAttribute('width'), '320');
        }
      }

      // Frame 0 eyes (normal) vs Frame 4 eyes (blink)
      const f0Rects = frames[0].getElementsByTagName('rect');
      let f0EyeCount = 0;
      for (let i = 0; i < f0Rects.length; i++) {
        const r = f0Rects[i];
        if (r.getAttribute('y') === '140' && r.getAttribute('width') === '25') {
          assert.equal(r.getAttribute('height'), '25');
          f0EyeCount++;
        }
      }
      assert.equal(f0EyeCount, 2);

      const f4Rects = frames[4].getElementsByTagName('rect');
      let f4BlinkCount = 0;
      for (let i = 0; i < f4Rects.length; i++) {
        const r = f4Rects[i];
        if (r.getAttribute('width') === '25' && r.getAttribute('height') === '3') {
          assert.equal(r.getAttribute('y'), '151');
          f4BlinkCount++;
        }
      }
      assert.equal(f4BlinkCount, 2);
    }
  });

  test('unknown or malicious SVG art is rejected', () => {
    const emptySvg = Buffer.from('<svg/>').toString('base64');
    assert.equal(botsComputerCompanion(`data:image/svg+xml;base64,${emptySvg}`), null);
    assert.equal(botsComputerCompanion('https://example.com/art.svg'), null);

    const scriptSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><script/></svg>'
    ).toString('base64');
    assert.equal(botsComputerCompanion(`data:image/svg+xml;base64,${scriptSvg}`), null);
  });
});
