import { MPEGDecoder } from 'mpg123-decoder';
import { sliceMp3, soundStart } from './mp3';

let decoder: Promise<MPEGDecoder> | null = null;
/** One shared WASM decoder; `reset()` is async, so analyses run one after another. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Seconds of silence (or faint intro) at the start of a preview. Deezer sometimes cuts previews
 * right before a quiet intro, so the 0.3s and 1s levels would be pure silence.
 * Only the part where a start could be is decoded (~200ms for a whole preview otherwise).
 */
export function detectSoundStart(mp3: Uint8Array, previewSeconds: number, maxSkip: number): Promise<number> {
  const run = queue.then(async () => {
    decoder ??= (async () => {
      const d = new MPEGDecoder();
      await d.ready;
      return d;
    })();
    const d = await decoder;
    try {
      const head = sliceMp3(mp3, maxSkip + 1, previewSeconds);
      const { channelData, sampleRate } = d.decode(head);
      return channelData[0]?.length ? soundStart(channelData[0], sampleRate, maxSkip) : 0;
    } finally {
      await d.reset();
    }
  });
  queue = run.catch(() => undefined);
  return run.catch((err) => {
    console.error('[audio] could not analyse preview', err);
    return 0;
  });
}
