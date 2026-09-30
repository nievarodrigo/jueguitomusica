/** Size of a leading ID3v2 tag (header included), 0 if there is none. */
export function id3Size(buf: Uint8Array): number {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0;
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
  return 10 + size;
}

/** Index of the first MPEG frame header (11 set sync bits) at or after `from`. */
function nextFrame(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.length - 1; i++) if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return i;
  return buf.length;
}

/**
 * `seconds` of a constant-bitrate MP3 (Deezer previews are 128kbps CBR) starting at `fromSeconds`.
 * The start is moved to a frame boundary so decoders never see half a frame first; cutting the
 * end mid-frame is fine (decoders drop a trailing partial frame). The ID3 tag is kept.
 */
export function sliceMp3(buf: Uint8Array, seconds: number, totalSeconds: number, fromSeconds = 0): Uint8Array {
  const tag = id3Size(buf);
  const bytesPerSecond = (buf.length - tag) / totalSeconds;
  const end = Math.min(buf.length, tag + Math.round((fromSeconds + seconds) * bytesPerSecond));
  if (fromSeconds <= 0) return seconds >= totalSeconds ? buf : buf.subarray(0, end);

  const start = nextFrame(buf, tag + Math.round(fromSeconds * bytesPerSecond));
  const out = new Uint8Array(tag + Math.max(0, end - start));
  out.set(buf.subarray(0, tag));
  out.set(buf.subarray(start, Math.max(start, end)), tag);
  return out;
}

const WINDOW_SECONDS = 0.05;
const ABSOLUTE_FLOOR = 0.02;
const RELATIVE_FLOOR = 0.2;

/**
 * Where the music actually starts: the first 50ms window reaching 20% of the song's typical
 * loudness (90th percentile RMS). Relative, so crowd noise or hiss before a live song is skipped
 * too, while a song that is quiet all along is left alone.
 */
export function soundStart(samples: Float32Array, sampleRate: number, maxSeconds = Infinity): number {
  const win = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  const rms: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / win));
  }
  if (rms.length === 0) return 0;
  const typical = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)];
  const first = rms.findIndex((r) => r >= Math.max(ABSOLUTE_FLOOR, RELATIVE_FLOOR * typical));
  return first <= 0 ? 0 : Math.min(maxSeconds, first * WINDOW_SECONDS);
}
