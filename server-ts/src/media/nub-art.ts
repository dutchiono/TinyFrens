import { PNG } from 'pngjs';
import { CompanionRig } from './hood-turtle-art.js';

export function nubCompanion(image: unknown): CompanionRig | null {
  if (typeof image !== 'string' || !image.startsWith('data:image/') || !image.includes(';base64,')) return null;
  try {
    const raw = Buffer.from(image.split(',', 2)[1], 'base64');
    if (raw.length < 100 || raw.length > 5_000_000) return null;
    const decoded = PNG.sync.read(raw);
    if (decoded.width < 16 || decoded.height < 16 || decoded.width > 4096 || decoded.height > 4096) return null;
    const base = resizeNearest(decoded, 256, 256);
    const configs: Array<[number, number, number]> = [
      [1, 1, 0],
      [1.08, 0.9, 0],
      [0.94, 1.12, -26],
      [1.03, 0.96, -4],
    ];
    const frames = configs.map(([scaleX, scaleY, offsetY]) => {
      const width = Math.trunc(220 * scaleX);
      const height = Math.trunc(220 * scaleY);
      const scaled = resizeNearest(base, width, height);
      const frame = new PNG({ width: 256, height: 256, colorType: 6 });
      blit(scaled, frame, Math.trunc((256 - width) / 2), 256 - 18 - height + offsetY);
      return `data:image/png;base64,${PNG.sync.write(frame, { colorType: 6 }).toString('base64')}`;
    });
    return { adapter: 'nubs-v1', frames, frameMs: 160, idle: frames[0] };
  } catch {
    return null;
  }
}

function resizeNearest(source: PNG, width: number, height: number): PNG {
  const target = new PNG({ width, height, colorType: 6 });
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.trunc(y * source.height / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.trunc(x * source.width / width));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return target;
}

function blit(source: PNG, target: PNG, left: number, top: number): void {
  for (let y = 0; y < source.height; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= target.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= target.width) continue;
      const sourceOffset = (y * source.width + x) * 4;
      const targetOffset = (targetY * target.width + targetX) * 4;
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}
