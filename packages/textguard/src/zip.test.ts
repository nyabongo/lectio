import { describe, expect, it } from 'vitest';

import { writeZip } from './fixtures/zip-writer.ts';
import { readZip } from './zip.ts';

const text = (data: Uint8Array): string => new TextDecoder().decode(data);

/** A one-entry archive plus the offset of its central directory record. */
function single(method: 0 | 8 = 8): { bytes: Uint8Array; view: DataView; central: number } {
  const bytes = writeZip([{ name: 'a.txt', data: 'alpha beta gamma', method }]);
  const view = new DataView(bytes.buffer);
  return { bytes, view, central: view.getUint32(bytes.length - 22 + 16, true) };
}

describe('readZip', () => {
  it('reads stored and deflated entries and skips directories', () => {
    const bytes = writeZip(
      [
        { name: 'dir/', data: '', method: 0 },
        { name: 'dir/one.txt', data: 'stored text', method: 0 },
        { name: 'dir/two.txt', data: 'deflated text '.repeat(50) },
      ],
      'an archive comment',
    );
    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(['dir/one.txt', 'dir/two.txt']);
    expect(text(entries[0]!.data)).toBe('stored text');
    expect(text(entries[1]!.data)).toBe('deflated text '.repeat(50));
  });

  it('reads an archive held in a larger buffer', () => {
    const bytes = writeZip([{ name: 'x.txt', data: 'offset view' }]);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    expect(text(readZip(padded.subarray(8))[0]!.data)).toBe('offset view');
  });

  it('rejects data without an end-of-central-directory record', () => {
    expect(() => readZip(new Uint8Array(100))).toThrow('end of central directory not found');
  });

  it('rejects a corrupt central directory', () => {
    const { bytes, view, central } = single();
    view.setUint32(central, 0, true);
    expect(() => readZip(bytes)).toThrow('corrupt central directory');
  });

  it('rejects a central directory that runs past the end', () => {
    const { bytes, view } = single();
    view.setUint32(bytes.length - 22 + 16, bytes.length - 10, true);
    expect(() => readZip(bytes)).toThrow('corrupt central directory');
  });

  it('rejects encrypted entries', () => {
    const { bytes, view, central } = single();
    view.setUint16(central + 8, 1, true);
    expect(() => readZip(bytes)).toThrow('a.txt is encrypted');
  });

  it.each([20, 24, 42])('rejects ZIP64 sentinels (field at +%i)', (field) => {
    const { bytes, view, central } = single();
    view.setUint32(central + field, 0xffffffff, true);
    expect(() => readZip(bytes)).toThrow('needs ZIP64');
  });

  it('rejects a corrupt local header', () => {
    const { bytes, view } = single();
    view.setUint32(0, 0, true);
    expect(() => readZip(bytes)).toThrow('corrupt local header for a.txt');
  });

  it('rejects a local header offset past the end', () => {
    const { bytes, view, central } = single();
    view.setUint32(central + 42, bytes.length, true);
    expect(() => readZip(bytes)).toThrow('corrupt local header for a.txt');
  });

  it('rejects truncated entry data', () => {
    const { bytes, view, central } = single();
    view.setUint32(central + 20, bytes.length, true);
    expect(() => readZip(bytes)).toThrow('a.txt is truncated');
  });

  it('rejects unsupported compression methods', () => {
    const { bytes, view, central } = single();
    view.setUint16(central + 10, 12, true);
    expect(() => readZip(bytes)).toThrow('unsupported compression method 12');
  });

  it('rejects a wrong uncompressed size', () => {
    const { bytes, view, central } = single(0);
    view.setUint32(central + 24, 3, true);
    expect(() => readZip(bytes)).toThrow('a.txt has the wrong size');
  });

  it('rejects a failed CRC-32 check', () => {
    const { bytes, view, central } = single(0);
    view.setUint32(central + 16, 1234, true);
    expect(() => readZip(bytes)).toThrow('a.txt fails its CRC-32 check');
  });
});
