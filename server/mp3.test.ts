import { describe, expect, it } from 'vitest';
import { id3Size, sliceMp3, soundStart } from './mp3';

/** ID3v2 header with a syncsafe size, followed by `audio` bytes of fake audio. */
function mp3(tagBody: number, audio: number): Uint8Array {
  const buf = new Uint8Array(10 + tagBody + audio);
  buf.set([0x49, 0x44, 0x33, 4, 0, 0]);
  buf.set([(tagBody >> 21) & 0x7f, (tagBody >> 14) & 0x7f, (tagBody >> 7) & 0x7f, tagBody & 0x7f], 6);
  return buf;
}

describe('id3Size', () => {
  it('is 0 without an ID3 tag', () => {
    expect(id3Size(new Uint8Array([0xff, 0xfb, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(0);
  });

  it('reads the syncsafe size plus the 10-byte header', () => {
    expect(id3Size(mp3(0, 5))).toBe(10);
    expect(id3Size(mp3(300, 5))).toBe(310);
  });
});

describe('sliceMp3', () => {
  const file = mp3(100, 30_000); // 30s at 1000 bytes/s

  it('keeps the tag and only the audio bytes for the allowed seconds', () => {
    expect(sliceMp3(file, 1, 30).length).toBe(110 + 1000);
  });

  it('scales with the allowed time', () => {
    expect(sliceMp3(file, 5, 30).length).toBe(110 + 5000);
  });

  it('returns the whole file when the allowance covers it', () => {
    expect(sliceMp3(file, 30, 30).length).toBe(file.length);
    expect(sliceMp3(file, Infinity, 30).length).toBe(file.length);
  });
});

describe('sliceMp3 from an offset', () => {
  // 30s at 1000 bytes/s, with an MP3 frame sync (0xFF 0xFB) every 400 bytes of audio.
  const file = mp3(100, 30_000);
  for (let i = 110; i < file.length - 1; i += 400) file.set([0xff, 0xfb], i);

  it('keeps the tag and starts at the first frame at or after the offset', () => {
    const out = sliceMp3(file, 1, 30, 2); // from 2s = byte 110 + 2000, next frame at 110 + 2000
    expect([...out.subarray(0, 10)]).toEqual([...file.subarray(0, 10)]);
    expect(out[110]).toBe(0xff);
    expect(out[111]).toBe(0xfb);
  });

  it('never starts mid-frame', () => {
    const out = sliceMp3(file, 1, 30, 2.05); // byte 2160 is mid-frame: next frame starts at 2510
    expect([out[110], out[111]]).toEqual([0xff, 0xfb]);
    expect(out.length).toBe(110 + (110 + 3050 - 2510));
  });

  it('serves until the end of the file when the allowance runs past it', () => {
    const out = sliceMp3(file, Infinity, 30, 2);
    expect(out.length).toBe(110 + (file.length - (110 + 2000)));
  });
});

describe('soundStart', () => {
  const RATE = 1000;
  const signal = (parts: [seconds: number, amplitude: number][]) => {
    const out: number[] = [];
    for (const [seconds, amp] of parts)
      for (let i = 0; i < seconds * RATE; i++) out.push(amp * Math.sin(i / 3));
    return Float32Array.from(out);
  };

  it('is 0 when the song starts right away', () => {
    expect(soundStart(signal([[10, 0.5]]), RATE)).toBe(0);
  });

  it('skips leading silence', () => {
    expect(soundStart(signal([[2.25, 0], [10, 0.5]]), RATE)).toBeCloseTo(2.25, 1);
  });

  it('skips a faint intro relative to how loud the song is (crowd noise, hiss)', () => {
    expect(soundStart(signal([[1.8, 0.03], [10, 0.6]]), RATE)).toBeCloseTo(1.8, 1);
  });

  it('keeps a quiet song that is quiet all along', () => {
    expect(soundStart(signal([[10, 0.05]]), RATE)).toBe(0);
  });

  it('never skips more than the cap', () => {
    expect(soundStart(signal([[20, 0], [10, 0.5]]), RATE, 15)).toBe(15);
  });
});
