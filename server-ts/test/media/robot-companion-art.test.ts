import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser, type Element } from '@xmldom/xmldom';
import { robotCompanion, SVG_NS } from '../../src/media/robot-companion-art.js';

describe('Media: Robot Companion Art', () => {
  const fixturePath = path.resolve(process.cwd(), '../server/fixtures/robots-v1/1.svg');
  const svgData = fs.readFileSync(
    fs.existsSync(fixturePath)
      ? fixturePath
      : path.resolve(process.cwd(), 'server/fixtures/robots-v1/1.svg')
  );
  const base64Image = 'data:image/svg+xml;base64,' + svgData.toString('base64');

  test('actual minted art keeps character paths and removes scene and shadow', () => {
    const rig = robotCompanion(base64Image);

    assert.equal(rig.frames.length, 8);
    assert.equal(rig.frameMs, 141);
    assert.equal(new Set(rig.frames).size, 8);

    // Verify against original SVG
    const parser = new DOMParser();
    const originalDoc = parser.parseFromString(svgData.toString('utf-8'), 'image/svg+xml');
    const originalRoot = originalDoc.documentElement;

    let character: Element | null = null;
    for (let i = 0; i < originalRoot.childNodes.length; i++) {
      const node = originalRoot.childNodes[i];
      if (
        node.nodeType === 1 &&
        (node as Element).localName === 'g' &&
        (node as Element).getAttribute('transform') === 'translate(16 30)'
      ) {
        character = node as Element;
        break;
      }
    }
    assert.ok(character);

    // Extract expected paths
    const getPaths = (el: Element): Record<string, string>[] => {
      const paths: Record<string, string>[] = [];
      const queue = [el];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (let i = 0; i < curr.childNodes.length; i++) {
          const child = curr.childNodes[i];
          if (child.nodeType === 1) {
            const childEl = child as Element;
            if (childEl.getAttribute('class') === 'shadow') continue;
            if (childEl.localName === 'path') {
              const attrs: Record<string, string> = {};
              for (let a = 0; a < childEl.attributes.length; a++) {
                const attr = childEl.attributes[a];
                attrs[attr.name] = attr.value;
              }
              paths.push(attrs);
            }
            queue.push(childEl);
          }
        }
      }
      return paths;
    };

    const expectedPaths = getPaths(character);

    for (const img of [rig.idle, ...rig.frames]) {
      const raw = Buffer.from(img.slice('data:image/svg+xml;base64,'.length), 'base64').toString(
        'utf-8'
      );
      const doc = parser.parseFromString(raw, 'image/svg+xml');
      const root = doc.documentElement;

      const actualPaths = getPaths(root);
      assert.deepEqual(actualPaths, expectedPaths);

      // Only one root child element (<g transform="translate(16 30)">)
      let childElementCount = 0;
      for (let i = 0; i < root.childNodes.length; i++) {
        if (root.childNodes[i].nodeType === 1) childElementCount++;
      }
      assert.equal(childElementCount, 1);
    }
  });

  test('rejects non-svg or bad payload', () => {
    assert.throws(() => robotCompanion('data:image/png;base64,AAAA'), /Invalid Robots v1 artwork/);
    assert.throws(() => robotCompanion('not an image'), /Invalid Robots v1 artwork/);
  });
});
