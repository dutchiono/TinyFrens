import { DOMParser, XMLSerializer, type Element, type Node } from '@xmldom/xmldom';
import { CompanionRig } from './hood-turtle-art.js';

export const EYE_PATHS = new Set([
  'M105,155 Q122,130 140,155',
  'M180,155 Q197,130 215,155',
  'M110,138 L134,162 M134,138 L110,162',
  'M185,138 L209,162 M209,138 L185,162',
  'M110,145 A8,8 0 0,1 122,140 A8,8 0 0,1 134,145 Q122,165 110,145 Z',
  'M185,145 A8,8 0 0,1 197,140 A8,8 0 0,1 209,145 Q197,165 185,145 Z',
]);

const ALLOWED_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path', 'g', 'line']);
const ALLOWED_ATTRIBUTES = new Set([
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'transform',
  'x1',
  'y1',
  'x2',
  'y2',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
]);

export function botsComputerCompanion(image: unknown): CompanionRig | null {
  if (typeof image !== 'string') return null;

  try {
    let rawBuffer: Buffer;
    if (image.startsWith('data:image/svg+xml;base64,')) {
      rawBuffer = Buffer.from(image.split(',', 2)[1], 'base64');
    } else if (image.startsWith('<svg')) {
      rawBuffer = Buffer.from(image, 'utf-8');
    } else {
      return null;
    }

    if (
      rawBuffer.length > 150_000 ||
      rawBuffer.includes(Buffer.from('<!')) ||
      rawBuffer.includes(Buffer.from('<script'))
    ) {
      return null;
    }

    const rawSvg = rawBuffer.toString('utf-8');
    const parser = new DOMParser({
      onError: (level, msg) => {
        if (level === 'fatalError') {
          throw new Error(msg);
        }
      },
    });

    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    const root = doc.documentElement;

    if (!root || root.localName !== 'svg' || root.getAttribute('viewBox') !== '0 0 320 320') {
      return null;
    }

    // Filter out defs and background 320x320 rect
    const childNodes: Element[] = [];
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes[i];
      if (node.nodeType === 1) {
        const el = node as Element;
        if (
          el.localName === 'defs' ||
          (el.localName === 'rect' &&
            el.getAttribute('width') === '320' &&
            el.getAttribute('height') === '320')
        ) {
          continue;
        }
        childNodes.push(el);
      }
    }

    const hasChassis = childNodes.some(
      n => n.localName === 'rect' && n.getAttribute('x') === '55' && n.getAttribute('y') === '75'
    );
    const hasScreen = childNodes.some(
      n => n.localName === 'rect' && n.getAttribute('x') === '75' && n.getAttribute('y') === '95'
    );
    if (!hasChassis || !hasScreen) {
      return null;
    }

    // Tag and attribute validation
    function validateNode(node: Node): boolean {
      if (node.nodeType === 1) {
        const el = node as Element;
        if (!el.localName || !ALLOWED_TAGS.has(el.localName)) return false;
        for (let j = 0; j < el.attributes.length; j++) {
          if (!ALLOWED_ATTRIBUTES.has(el.attributes[j].name)) return false;
        }
      }
      for (let i = 0; i < node.childNodes.length; i++) {
        if (!validateNode(node.childNodes[i])) return false;
      }
      return true;
    }

    for (const node of childNodes) {
      if (!validateNode(node)) return null;
    }

    // Eye detection
    const eyes: Element[] = [];
    for (const n of childNodes) {
      const tag = n.localName;
      if (
        tag === 'rect' &&
        ((['110', '185'].includes(n.getAttribute('x') || '') &&
          n.getAttribute('width') === '25' &&
          n.getAttribute('height') === '25' &&
          n.getAttribute('y') === '140') ||
          (['105', '180'].includes(n.getAttribute('x') || '') &&
            n.getAttribute('width') === '35' &&
            n.getAttribute('height') === '10' &&
            n.getAttribute('y') === '148') ||
          (n.getAttribute('x') === '105' &&
            n.getAttribute('width') === '110' &&
            n.getAttribute('height') === '16' &&
            n.getAttribute('y') === '144') ||
          (n.getAttribute('x') === '145' &&
            n.getAttribute('width') === '30' &&
            n.getAttribute('height') === '12' &&
            n.getAttribute('y') === '146'))
      ) {
        eyes.push(n);
      } else if (
        tag === 'circle' &&
        ['122', '197'].includes(n.getAttribute('cx') || '') &&
        n.getAttribute('cy') === '150' &&
        n.getAttribute('r') === '14'
      ) {
        eyes.push(n);
      } else if (tag === 'path' && EYE_PATHS.has(n.getAttribute('d') || '')) {
        eyes.push(n);
      }
    }

    if (eyes.length !== 2) {
      return null;
    }

    const serializer = new XMLSerializer();
    const frames: string[] = [];

    for (let phase = 0; phase < 6; phase++) {
      const frameDoc = parser.parseFromString(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="128" height="128" shape-rendering="crispEdges"/>',
        'image/svg+xml'
      );
      const frameRoot = frameDoc.documentElement;
      if (!frameRoot) {
        return null;
      }

      for (const original of childNodes) {
        const cloned = original.cloneNode(true) as Element;
        const isEye = eyes.includes(original);
        const tag = cloned.localName;

        if (isEye) {
          if (phase === 4) {
            if (tag === 'rect') {
              const origY = parseInt(original.getAttribute('y') || '0', 10);
              const origH = parseInt(original.getAttribute('height') || '0', 10);
              const newY = origY + Math.floor((origH - 3) / 2);
              cloned.setAttribute('y', String(newY));
              cloned.setAttribute('height', '3');
            } else {
              cloned.setAttribute('transform', 'translate(0 150) scale(1 0.12) translate(0 -150)');
            }
          }
        } else if (tag === 'circle' && cloned.getAttribute('cy') === '253') {
          const cx = cloned.getAttribute('cx');
          if (cx === '230') {
            cloned.setAttribute('fill', phase === 1 || phase === 4 ? '#81c784' : '#4caf50');
          } else if (cx === '245') {
            cloned.setAttribute('fill', phase === 1 || phase === 3 ? '#ff5252' : '#3a1111');
          }
        } else if (phase === 1) {
          if (tag === 'circle' && cloned.getAttribute('cy') === '200') {
            cloned.setAttribute('r', '17');
            cloned.setAttribute('stroke-width', '7');
          } else if (
            tag === 'path' &&
            ['195', '200', '205'].some(pos => cloned.getAttribute('d')?.includes(pos))
          ) {
            const origW = parseInt(original.getAttribute('stroke-width') || '7', 10);
            cloned.setAttribute('stroke-width', String(origW + 3));
          }
        }

        frameRoot.appendChild(cloned);
      }

      const serializedSvg = serializer.serializeToString(frameRoot);
      const b64 = Buffer.from(serializedSvg, 'utf-8').toString('base64');
      frames.push(`data:image/svg+xml;base64,${b64}`);
    }

    return {
      adapter: 'bots-computers-v1',
      frames,
      frameMs: 220,
      idle: frames[0],
    };
  } catch {
    return null;
  }
}
