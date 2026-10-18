import { inflateSync } from 'node:zlib';
import { DOMParser, type Element } from '@xmldom/xmldom';

export interface TelegramCompanionRig {
  frames: string[];
  frameMs?: number;
}

interface RasterFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

type Point = [number, number];

function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorValue(value: string | null, opacity = 1): [number, number, number, number] | null {
  if (!value || value === 'none') return null;
  const normalized = /^#[0-9a-f]{3}$/i.test(value)
    ? '#' + [...value.slice(1)].map(char => char + char).join('')
    : value;
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) throw new Error('Unsupported SVG color');
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    Math.max(0, Math.min(255, Math.round(255 * opacity))),
  ];
}

function translateValue(value: string | null): Point {
  if (!value) return [0, 0];
  const match = value.match(/^translate\(\s*(-?[0-9.]+)(?:[ ,]+(-?[0-9.]+))?\s*\)$/);
  if (!match) throw new Error('Unsupported SVG transform');
  return [numberValue(match[1]), numberValue(match[2])];
}

function pathPolygons(value: string | null): Point[][] {
  const tokens = (value || '').match(/[MmHhVvLlZz]|-?(?:\d+(?:\.\d*)?|\.\d+)/g) || [];
  const polygons: Point[][] = [];
  let points: Point[] = [];
  let x = 0;
  let y = 0;
  let command = '';
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index += 1;
      if (command === 'Z' || command === 'z') {
        if (points.length > 0) polygons.push(points);
        points = [];
        continue;
      }
    }
    if (['M', 'L', 'm', 'l'].includes(command)) {
      if (index + 1 >= tokens.length) throw new Error('Unsupported SVG path');
      let nextX = Number(tokens[index]);
      let nextY = Number(tokens[index + 1]);
      index += 2;
      if (command === command.toLowerCase()) {
        nextX += x;
        nextY += y;
      }
      x = nextX;
      y = nextY;
      points.push([x, y]);
      if (command === 'M') command = 'L';
      if (command === 'm') command = 'l';
    } else if (command === 'H' || command === 'h') {
      if (index >= tokens.length) throw new Error('Unsupported SVG path');
      const next = Number(tokens[index++]);
      x = command === 'h' ? x + next : next;
      points.push([x, y]);
    } else if (command === 'V' || command === 'v') {
      if (index >= tokens.length) throw new Error('Unsupported SVG path');
      const next = Number(tokens[index++]);
      y = command === 'v' ? y + next : next;
      points.push([x, y]);
    } else {
      throw new Error('Unsupported SVG path');
    }
  }
  if (points.length > 0) polygons.push(points);
  return polygons;
}

function setPixel(frame: RasterFrame, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const offset = (y * frame.width + x) * 4;
  frame.pixels.set(color, offset);
}

function fillRect(frame: RasterFrame, left: number, top: number, right: number, bottom: number, color: [number, number, number, number]): void {
  const x0 = Math.max(0, Math.floor(Math.min(left, right)));
  const y0 = Math.max(0, Math.floor(Math.min(top, bottom)));
  const x1 = Math.min(frame.width, Math.ceil(Math.max(left, right)));
  const y1 = Math.min(frame.height, Math.ceil(Math.max(top, bottom)));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) setPixel(frame, x, y, color);
  }
}

function fillPolygon(frame: RasterFrame, points: Point[], color: [number, number, number, number]): void {
  if (points.length < 3) return;
  const minY = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
  const maxY = Math.min(frame.height - 1, Math.ceil(Math.max(...points.map(point => point[1]))));
  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        intersections.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const end = Math.min(frame.width - 1, Math.floor(intersections[index + 1] - 0.5));
      for (let x = start; x <= end; x += 1) setPixel(frame, x, y, color);
    }
  }
}

function svgFrame(raw: Buffer, size = 128): RasterFrame {
  if (raw.length > 150_000 || raw.includes(Buffer.from('<!'))) throw new Error('Invalid SVG frame');
  const document = new DOMParser().parseFromString(raw.toString('utf8'), 'image/svg+xml');
  const root = document.documentElement;
  if (!root || root.tagName.split(':').at(-1) !== 'svg') throw new Error('Invalid SVG frame');
  const view = String(root.getAttribute('viewBox') || '').split(/\s+/).map(value => numberValue(value));
  if (view.length !== 4 || view[2] <= 0 || view[3] <= 0) throw new Error('SVG frame has no viewBox');
  const [left, top, width, height] = view;
  const frame: RasterFrame = { width: size, height: size, pixels: new Uint8Array(size * size * 4) };
  const scale = Math.min(size / width, size / height);
  const padX = (size - width * scale) / 2;
  const padY = (size - height * scale) / 2;
  const point = (x: number, y: number, dx: number, dy: number): Point => [
    (x + dx - left) * scale + padX,
    (y + dy - top) * scale + padY,
  ];
  const visit = (node: Element, dx = 0, dy = 0, inheritedOpacity = 1) => {
    const [tx, ty] = translateValue(node.getAttribute('transform'));
    const nextX = dx + tx;
    const nextY = dy + ty;
    const opacity = inheritedOpacity * numberValue(node.getAttribute('opacity'), 1);
    const tag = node.tagName.split(':').at(-1);
    const fill = node.hasAttribute('fill') ? colorValue(node.getAttribute('fill'), opacity) : null;
    if (tag === 'rect' && fill) {
      const x = numberValue(node.getAttribute('x'));
      const y = numberValue(node.getAttribute('y'));
      const widthValue = numberValue(node.getAttribute('width'));
      const heightValue = numberValue(node.getAttribute('height'));
      const [x0, y0] = point(x, y, nextX, nextY);
      const [x1, y1] = point(x + widthValue, y + heightValue, nextX, nextY);
      fillRect(frame, x0, y0, x1, y1, fill);
    } else if (tag === 'path' && fill) {
      for (const polygon of pathPolygons(node.getAttribute('d'))) {
        fillPolygon(frame, polygon.map(([x, y]) => point(x, y, nextX, nextY)), fill);
      }
    } else if (tag !== 'svg' && tag !== 'g') {
      throw new Error('Unsupported SVG element');
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes.item(index);
      if (child?.nodeType === 1) visit(child as Element, nextX, nextY, opacity);
    }
  };
  visit(root);
  return frame;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const diagonalDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= upDistance && leftDistance <= diagonalDistance ? left : upDistance <= diagonalDistance ? up : upperLeft;
}

function pngFrame(raw: Buffer): RasterFrame {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (raw.length > 5_000_000 || !raw.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG frame');
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const imageChunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= raw.length;) {
    const length = raw.readUInt32BE(offset);
    const type = raw.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > raw.length) throw new Error('Invalid PNG frame');
    const data = raw.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') imageChunks.push(data);
    else if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!width || !height || width * height > 4_000_000 || bitDepth !== 8 || interlace !== 0 || !channels || imageChunks.length === 0) {
    throw new Error('Unsupported PNG frame');
  }
  const packed = inflateSync(Buffer.concat(imageChunks));
  const stride = width * channels;
  if (packed.length !== (stride + 1) * height) throw new Error('Invalid PNG frame');
  const decoded = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[sourceOffset++];
    for (let x = 0; x < stride; x += 1) {
      const rawValue = packed[sourceOffset++];
      const left = x >= channels ? decoded[y * stride + x - channels] : 0;
      const up = y > 0 ? decoded[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      let value: number;
      if (filter === 0) value = rawValue;
      else if (filter === 1) value = rawValue + left;
      else if (filter === 2) value = rawValue + up;
      else if (filter === 3) value = rawValue + Math.floor((left + up) / 2);
      else if (filter === 4) value = rawValue + paeth(left, up, upperLeft);
      else throw new Error('Unsupported PNG filter');
      decoded[y * stride + x] = value & 255;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    if (colorType === 6) pixels.set(decoded.subarray(source, source + 4), target);
    else if (colorType === 2) pixels.set([decoded[source], decoded[source + 1], decoded[source + 2], 255], target);
    else if (colorType === 4) pixels.set([decoded[source], decoded[source], decoded[source], decoded[source + 1]], target);
    else if (colorType === 0) pixels.set([decoded[source], decoded[source], decoded[source], 255], target);
    else {
      const paletteIndex = decoded[source];
      const paletteOffset = paletteIndex * 3;
      if (!palette || paletteOffset + 2 >= palette.length) throw new Error('Invalid PNG palette');
      pixels.set([palette[paletteOffset], palette[paletteOffset + 1], palette[paletteOffset + 2], transparency?.[paletteIndex] ?? 255], target);
    }
  }
  if (width <= 128 && height <= 128) return { width, height, pixels };
  const scale = Math.min(128 / width, 128 / height);
  const scaledWidth = Math.max(1, Math.floor(width * scale));
  const scaledHeight = Math.max(1, Math.floor(height * scale));
  const scaled = new Uint8Array(scaledWidth * scaledHeight * 4);
  for (let y = 0; y < scaledHeight; y += 1) {
    for (let x = 0; x < scaledWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceY = Math.min(height - 1, Math.floor(y / scale));
      scaled.set(pixels.subarray((sourceY * width + sourceX) * 4, (sourceY * width + sourceX) * 4 + 4), (y * scaledWidth + x) * 4);
    }
  }
  return { width: scaledWidth, height: scaledHeight, pixels: scaled };
}

function centeredFrame(source: RasterFrame): RasterFrame {
  if (source.width === 128 && source.height === 128) return source;
  const frame: RasterFrame = { width: 128, height: 128, pixels: new Uint8Array(128 * 128 * 4) };
  const left = Math.floor((128 - source.width) / 2);
  const top = Math.floor((128 - source.height) / 2);
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((top + y) * 128 + left) * 4;
    frame.pixels.set(source.pixels.subarray(sourceStart, sourceStart + source.width * 4), targetStart);
  }
  return frame;
}

function rasterFrame(value: string): RasterFrame {
  if (value.startsWith('data:image/png;base64,')) {
    return centeredFrame(pngFrame(Buffer.from(value.slice('data:image/png;base64,'.length), 'base64')));
  }
  if (value.startsWith('data:image/svg+xml;base64,')) {
    return svgFrame(Buffer.from(value.slice('data:image/svg+xml;base64,'.length), 'base64'));
  }
  throw new Error('Unsupported companion frame');
}

function paletteIndex(red: number, green: number, blue: number, alpha: number): number {
  if (alpha < 128) return 0;
  const index = ((red >> 5) << 5) | ((green >> 5) << 2) | (blue >> 6);
  return index === 0 ? 1 : index;
}

function globalPalette(): Buffer {
  const palette = Buffer.alloc(256 * 3);
  for (let index = 1; index < 256; index += 1) {
    palette[index * 3] = Math.round(((index >> 5) & 7) * 255 / 7);
    palette[index * 3 + 1] = Math.round(((index >> 2) & 7) * 255 / 7);
    palette[index * 3 + 2] = Math.round((index & 3) * 255 / 3);
  }
  return palette;
}

function lzwEncode(values: Uint8Array): Buffer {
  const clearCode = 256;
  const endCode = 257;
  let currentByte = 0;
  let currentBits = 0;
  const output: number[] = [];
  const emit = (code: number) => {
    currentByte |= code << currentBits;
    currentBits += 9;
    while (currentBits >= 8) {
      output.push(currentByte & 255);
      currentByte >>>= 8;
      currentBits -= 8;
    }
  };

  // Keep the stream at the minimum nine-bit code width. Clearing before the
  // decoder's dictionary reaches 512 entries is a little larger than adaptive
  // compression, but remains small for 128px companion frames and avoids
  // code-width transitions that some Telegram decoders reject as blank media.
  for (let offset = 0; offset < values.length; offset += 250) {
    emit(clearCode);
    const end = Math.min(values.length, offset + 250);
    for (let index = offset; index < end; index += 1) emit(values[index]);
  }
  emit(endCode);
  if (currentBits > 0) output.push(currentByte & 255);
  return Buffer.from(output);
}

function gifFrame(frame: RasterFrame, delay: number): Buffer {
  const indexed = new Uint8Array(frame.width * frame.height);
  for (let index = 0; index < indexed.length; index += 1) {
    const offset = index * 4;
    indexed[index] = paletteIndex(
      frame.pixels[offset],
      frame.pixels[offset + 1],
      frame.pixels[offset + 2],
      frame.pixels[offset + 3]
    );
  }
  const compressed = lzwEncode(indexed);
  const blocks: Buffer[] = [];
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const block = compressed.subarray(offset, offset + 255);
    blocks.push(Buffer.from([block.length]), block);
  }
  const header = Buffer.alloc(18);
  header.set([0x21, 0xf9, 0x04, 0x09], 0);
  header.writeUInt16LE(delay, 4);
  header.set([0x00, 0x00, 0x2c], 6);
  header.writeUInt16LE(0, 9);
  header.writeUInt16LE(0, 11);
  header.writeUInt16LE(frame.width, 13);
  header.writeUInt16LE(frame.height, 15);
  header[17] = 0;
  return Buffer.concat([header, Buffer.from([8]), ...blocks, Buffer.from([0])]);
}

export function companionGif(rig: TelegramCompanionRig): Buffer {
  const frames = rig && Array.isArray(rig.frames) ? rig.frames : null;
  if (!frames || frames.length < 2 || frames.length > 12) throw new Error('Companion animation is unavailable');
  const images = frames.map(rasterFrame);
  const duration = Math.max(80, Math.min(500, Math.trunc(rig.frameMs || 160)));
  const header = Buffer.alloc(13);
  header.write('GIF89a', 0, 'ascii');
  header.writeUInt16LE(128, 6);
  header.writeUInt16LE(128, 8);
  header[10] = 0xf7;
  header[11] = 0;
  header[12] = 0;
  const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00]);
  const output = Buffer.concat([
    header,
    globalPalette(),
    loop,
    ...images.map(image => gifFrame(image, Math.round(duration / 10))),
    Buffer.from([0x3b]),
  ]);
  if (output.length > 10_000_000) throw new Error('Companion animation is too large for Telegram');
  return output;
}
