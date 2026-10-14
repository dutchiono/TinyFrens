import { DOMParser, XMLSerializer, type Element, type Node } from '@xmldom/xmldom';

export const ROBOTS_CONTRACT = '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff';
export const ROBOTS_CHAIN_ID = 8453;
export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface CompanionRig {
  adapter: string;
  frames: string[];
  frameMs: number;
  idle: string;
}

const ALLOWED_TAGS = new Set(['g', 'path', 'rect']);
const ALLOWED_ATTRIBUTES = new Set([
  'd',
  'fill',
  'opacity',
  'transform',
  'class',
  'x',
  'y',
  'width',
  'height',
  'xmlns',
]);

const FEET = [
  [-1, 0],
  [0, -1],
  [1, -2],
  [2, -1],
  [2, 0],
  [1, 0],
  [0, 0],
  [-1, 0],
];

const ARMS = [
  [1, 0],
  [-1, 1],
  [-1, 0],
  [1, -1],
];

function getAllDescendantElements(element: Element): Element[] {
  const result: Element[] = [element];
  const queue: Element[] = [element];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (let i = 0; i < curr.childNodes.length; i++) {
      const child = curr.childNodes[i];
      if (child.nodeType === 1) {
        // Element node
        result.push(child as Element);
        queue.push(child as Element);
      }
    }
  }
  return result;
}

export function robotCompanion(image: unknown): CompanionRig {
  if (typeof image !== 'string' || !image.startsWith('data:image/svg+xml;base64,')) {
    throw new Error('Invalid Robots v1 artwork');
  }

  const base64Data = image.slice('data:image/svg+xml;base64,'.length);
  const rawBuffer = Buffer.from(base64Data, 'base64');

  if (rawBuffer.length > 100_000 || rawBuffer.includes(Buffer.from('<!'))) {
    throw new Error('Invalid Robots v1 SVG');
  }

  const rawSvg = rawBuffer.toString('utf-8');
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level === 'fatalError') {
        throw new Error('Invalid Robots v1 SVG: ' + msg);
      }
    },
  });

  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const root = doc.documentElement;

  if (
    !root ||
    root.localName !== 'svg' ||
    root.getAttribute('viewBox') !== '0 0 128 128' ||
    root.getAttribute('data-species') !== '0'
  ) {
    throw new Error('Unexpected Robots v1 SVG structure');
  }

  // Find character layer: <g transform="translate(16 30)">
  const groups: Element[] = [];
  for (let i = 0; i < root.childNodes.length; i++) {
    const node = root.childNodes[i];
    if (
      node.nodeType === 1 &&
      (node as Element).localName === 'g' &&
      (node as Element).getAttribute('transform') === 'translate(16 30)'
    ) {
      groups.push(node as Element);
    }
  }

  if (groups.length !== 1) {
    throw new Error('Robot character layer missing');
  }

  const character = groups[0].cloneNode(true) as Element;

  // Remove shadow group: direct children with class="shadow"
  const childrenToRemove: Element[] = [];
  for (let i = 0; i < character.childNodes.length; i++) {
    const node = character.childNodes[i];
    if (node.nodeType === 1 && (node as Element).getAttribute('class') === 'shadow') {
      childrenToRemove.push(node as Element);
    }
  }
  for (const child of childrenToRemove) {
    character.removeChild(child);
  }

  // Validate drawing instructions
  const allNodes = getAllDescendantElements(character);
  for (const node of allNodes) {
    if (!node.localName || !ALLOWED_TAGS.has(node.localName)) {
      throw new Error('Unexpected robot drawing instruction');
    }
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i];
      if (!ALLOWED_ATTRIBUTES.has(attr.name)) {
        throw new Error('Unexpected robot drawing instruction');
      }
    }
  }

  const classes = new Set(
    allNodes
      .map(n => n.getAttribute('class'))
      .filter((c): c is string => Boolean(c))
  );
  if (
    !classes.has('body') ||
    !classes.has('foot-a') ||
    !classes.has('foot-b') ||
    !classes.has('arm-a') ||
    !classes.has('arm-b')
  ) {
    throw new Error('Robot walk layers missing');
  }

  // Style duration extraction
  let styleText = '';
  for (let i = 0; i < root.childNodes.length; i++) {
    const node = root.childNodes[i];
    if (node.nodeType === 1 && (node as Element).localName === 'style') {
      styleText += node.textContent || '';
    }
  }

  const durationMatch = styleText.match(/\.body\{animation:bob (0\.8471|1\.8824|0\.6588|1\.1294)s /);
  if (!durationMatch) {
    throw new Error('Robot walk timing missing');
  }

  const durationSeconds = parseFloat(durationMatch[1]);
  const frameMs = Math.round((durationSeconds * 1000) / 8);

  const serializer = new XMLSerializer();

  function renderFrame(phase?: number): string {
    const frameDoc = parser.parseFromString(
      `<svg xmlns="${SVG_NS}" viewBox="16 30 96 96" width="128" height="128" shape-rendering="crispEdges"/>`,
      'image/svg+xml'
    );
    const frameSvg = frameDoc.documentElement;
    if (!frameSvg) {
      throw new Error('Failed to create frame SVG');
    }
    const drawing = character.cloneNode(true) as Element;

    if (phase !== undefined) {
      const descendants = getAllDescendantElements(drawing);
      for (const node of descendants) {
        const cls = node.getAttribute('class');
        let delta: [number, number] | null = null;
        if (cls === 'body') {
          delta = [0, phase % 2 ? -1 : 0];
        } else if (cls === 'foot-a' || cls === 'foot-b') {
          const offset = cls === 'foot-b' ? 4 : 0;
          const idx = (phase + offset) % 8;
          delta = [FEET[idx][0], FEET[idx][1]];
        } else if (cls === 'arm-a' || cls === 'arm-b') {
          const offset = cls === 'arm-b' ? 4 : 0;
          const idx = Math.floor(((phase + offset) % 8) / 2);
          delta = [ARMS[idx][0], ARMS[idx][1]];
        }

        if (delta) {
          node.setAttribute('transform', `translate(${delta[0]} ${delta[1]})`);
        }
      }
    }

    frameSvg.appendChild(drawing as unknown as Node);
    const serialized = serializer.serializeToString(frameSvg as unknown as Node);
    const encoded = Buffer.from(serialized, 'utf-8').toString('base64');
    return 'data:image/svg+xml;base64,' + encoded;
  }

  const frames: string[] = [];
  for (let i = 0; i < 8; i++) {
    frames.push(renderFrame(i));
  }

  return {
    adapter: 'tinyfrens-robots-v1',
    frames,
    frameMs,
    idle: renderFrame(),
  };
}
