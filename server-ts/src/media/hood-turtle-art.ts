import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';

export interface CompanionRig {
  adapter: string;
  frames: string[];
  frameMs: number;
  idle: string;
}

export function hoodTurtleCompanion(image: unknown): CompanionRig | null {
  if (typeof image !== 'string' || !image.startsWith('data:image/svg+xml;base64,')) {
    return null;
  }

  try {
    const base64Data = image.split(',', 2)[1];
    const rawBuffer = Buffer.from(base64Data, 'base64');

    if (rawBuffer.length > 100_000 || rawBuffer.includes(Buffer.from('<!'))) {
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

    if (!root || root.localName !== 'svg' || root.getAttribute('viewBox') !== '0 0 32 32') {
      return null;
    }

    // Get direct child elements of svg
    const childNodes: Element[] = [];
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes[i];
      if (node.nodeType === 1) {
        childNodes.push(node as Element);
      }
    }

    // Find start of character at landmark: rect with x="5", y="18", width="3", height="2"
    let startIndex = -1;
    for (let i = 0; i < childNodes.length; i++) {
      const n = childNodes[i];
      if (
        n.localName === 'rect' &&
        n.getAttribute('x') === '5' &&
        n.getAttribute('y') === '18' &&
        n.getAttribute('width') === '3' &&
        n.getAttribute('height') === '2'
      ) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === -1) {
      return null;
    }

    const character = childNodes.slice(startIndex);
    const allowedAttrs = new Set(['x', 'y', 'width', 'height', 'fill', 'opacity']);

    for (const node of character) {
      if (node.localName !== 'rect') {
        return null;
      }
      for (let j = 0; j < node.attributes.length; j++) {
        const attrName = node.attributes[j].name;
        if (!allowedAttrs.has(attrName)) {
          return null;
        }
      }
      const opacityAttr = node.getAttribute('opacity');
      if (opacityAttr !== null && opacityAttr !== '') {
        const op = Number(opacityAttr);
        if (Number.isNaN(op) || op < 0 || op > 1) {
          return null;
        }
      }
    }

    // Legs landmark check: [('7', '20'), ('12', '21'), ('17', '20'), ('21', '21')] with height="4"
    const legs = [
      ['7', '20'],
      ['12', '21'],
      ['17', '20'],
      ['21', '21'],
    ];

    const hasAllLegs = legs.every(([lx, ly]) =>
      character.some(
        n =>
          n.getAttribute('x') === lx &&
          n.getAttribute('y') === ly &&
          n.getAttribute('height') === '4'
      )
    );

    if (!hasAllLegs) {
      return null;
    }

    const serializer = new XMLSerializer();
    const frames: string[] = [];
    const phases = [0, 1, 0, -1];

    for (const phase of phases) {
      const frameDoc = parser.parseFromString(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="128" height="128" shape-rendering="crispEdges"/>',
        'image/svg+xml'
      );
      const frameRoot = frameDoc.documentElement;
      if (!frameRoot) {
        return null;
      }

      for (const original of character) {
        const cloned = original.cloneNode(true) as Element;
        const x = parseInt(cloned.getAttribute('x') || '0', 10);
        const y = parseInt(cloned.getAttribute('y') || '0', 10);

        if (y >= 20 && [6, 7, 12, 17, 21].includes(x)) {
          const step = [6, 7, 21].includes(x) ? phase : -phase;
          cloned.setAttribute('x', String(x + step));
          cloned.setAttribute('y', String(y - (step > 0 ? 1 : 0)));
        }

        frameRoot.appendChild(cloned);
      }

      const serializedSvg = serializer.serializeToString(frameRoot);
      const b64 = Buffer.from(serializedSvg, 'utf-8').toString('base64');
      frames.push(`data:image/svg+xml;base64,${b64}`);
    }

    return {
      adapter: 'hood-turtles-v1',
      frames,
      frameMs: 160,
      idle: frames[0],
    };
  } catch {
    return null;
  }
}
