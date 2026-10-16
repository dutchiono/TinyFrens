import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, test } from 'node:test';
import { hoodTurtleCompanion } from '../../src/media/hood-turtle-art.js';
import { robotCompanion } from '../../src/media/robot-companion-art.js';
import { companionGif } from '../../src/media/telegram-gif.js';
import { FetchTelegramBotApi } from '../../src/integrations/telegram-api.js';

function pngDataUrl(red: number, green: number, blue: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const scanlines = Buffer.from([
    0, red, green, blue, 255, 0, 0, 0, 0,
    0, 0, 0, 0, 0, red, green, blue, 255,
  ]);
  const chunk = (type: string, data: Buffer) => {
    const output = Buffer.alloc(12 + data.length);
    output.writeUInt32BE(data.length, 0);
    output.write(type, 4, 'ascii');
    data.copy(output, 8);
    return output;
  };
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function inspectGif(buffer: Buffer): { width: number; height: number; frames: number; delays: number[] } {
  assert.equal(buffer.toString('ascii', 0, 6), 'GIF89a');
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  let offset = 13 + 3 * (2 ** ((buffer[10] & 7) + 1));
  let frames = 0;
  const delays: number[] = [];
  const skipBlocks = () => {
    while (true) {
      const length = buffer[offset++];
      if (length === 0) break;
      offset += length;
    }
  };
  while (offset < buffer.length && buffer[offset] !== 0x3b) {
    if (buffer[offset] === 0x21) {
      const label = buffer[offset + 1];
      offset += 2;
      if (label === 0xf9) {
        assert.equal(buffer[offset++], 4);
        offset += 1;
        delays.push(buffer.readUInt16LE(offset));
        offset += 4;
      } else {
        const fixed = buffer[offset++];
        offset += fixed;
        skipBlocks();
      }
    } else if (buffer[offset] === 0x2c) {
      frames += 1;
      const packed = buffer[offset + 9];
      offset += 10;
      if (packed & 0x80) offset += 3 * (2 ** ((packed & 7) + 1));
      assert.equal(buffer[offset++], 8);
      skipBlocks();
    } else {
      assert.fail(`Unexpected GIF block 0x${buffer[offset].toString(16)}`);
    }
  }
  assert.equal(buffer[offset], 0x3b);
  return { width, height, frames, delays };
}

describe('Telegram companion GIF renderer', () => {
  test('renders real robot and turtle companion rigs', () => {
    const robotSource = readFileSync(new URL('../../../server/fixtures/robots-v1/1.svg', import.meta.url));
    const turtleSource = readFileSync(new URL('../../../server/fixtures/hood-turtles/1.svg', import.meta.url));
    const rigs = [
      robotCompanion(`data:image/svg+xml;base64,${robotSource.toString('base64')}`),
      hoodTurtleCompanion(`data:image/svg+xml;base64,${turtleSource.toString('base64')}`),
    ];
    for (const rig of rigs) {
      assert.ok(rig);
      const gif = companionGif(rig);
      const inspected = inspectGif(gif);
      assert.equal(inspected.width, 128);
      assert.equal(inspected.height, 128);
      assert.equal(inspected.frames, rig.frames.length);
    }
  });

  test('renders bounded SVG path and rectangle frames', () => {
    const first = Buffer.from('<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" fill="#a474f1"/></svg>').toString('base64');
    const second = Buffer.from('<svg viewBox="0 0 16 16"><g transform="translate(2 1)"><path d="M 2 2 H 8 V 8 H 2 Z" fill="#66c7d2"/></g></svg>').toString('base64');
    const gif = companionGif({
      frames: [`data:image/svg+xml;base64,${first}`, `data:image/svg+xml;base64,${second}`],
      frameMs: 160,
    });
    assert.ok(gif.length < 10_000_000);
    assert.deepEqual(inspectGif(gif), { width: 128, height: 128, frames: 2, delays: [16, 16] });
  });

  test('renders and centers PNG frames', () => {
    const gif = companionGif({ frames: [pngDataUrl(164, 116, 241), pngDataUrl(102, 199, 210)] });
    assert.deepEqual(inspectGif(gif), { width: 128, height: 128, frames: 2, delays: [16, 16] });
  });

  test('rejects unsafe and unsupported frames', () => {
    const unsafe = Buffer.from('<!DOCTYPE svg><svg viewBox="0 0 1 1"></svg>').toString('base64');
    assert.throws(() => companionGif({ frames: [`data:image/svg+xml;base64,${unsafe}`, `data:image/svg+xml;base64,${unsafe}`] }), /Invalid SVG/);
    assert.throws(() => companionGif({ frames: ['bad', 'bad'] }), /Unsupported companion frame/);
  });

  test('encodes Telegram file uploads as multipart form data', async () => {
    let captured: RequestInit | undefined;
    const api = new FetchTelegramBotApi(async (_input, init) => {
      captured = init;
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });
    await api.call('sendAnimation', {
      chat_id: -100,
      animation: 'attach://animation',
      reply_markup: { inline_keyboard: [] },
    }, 'token', {
      animation: { data: Buffer.from('GIF89a'), filename: 'animation.gif', contentType: 'image/gif' },
    });
    assert.ok(captured?.body instanceof FormData);
    const form = captured?.body as FormData;
    assert.equal(form.get('chat_id'), '-100');
    assert.equal(form.get('reply_markup'), '{"inline_keyboard":[]}');
    const animationFields = form.getAll('animation');
    assert.equal(animationFields[0], 'attach://animation');
    const animation = animationFields[1] as File;
    assert.equal(typeof animation?.arrayBuffer, 'function');
    assert.equal(animation.type, 'image/gif');
    assert.equal(Buffer.from(await animation.arrayBuffer()).toString('ascii'), 'GIF89a');
    assert.equal(captured?.headers, undefined);
    assert.ok(captured?.signal instanceof AbortSignal);
  });
});
