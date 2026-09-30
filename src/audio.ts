/**
 * Plays exact-length snippets of a preview.
 * An <audio> element can't reliably stop after 300ms; the Web Audio API schedules
 * start/stop on the audio clock with sample precision.
 */
export class SnippetPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private url: string | null = null;
  private loading: Promise<void> | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** Previews sometimes start with silence; a 0.3s snippet of silence would be unfair. */
  private offset = 0;

  private context() {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  load(url: string): Promise<void> {
    if (url === this.url && this.loading) return this.loading;
    this.stop();
    this.url = url;
    this.buffer = null;
    this.loading = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`audio ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => this.context().decodeAudioData(data))
      .then((buffer) => {
        if (this.url !== url) return;
        this.buffer = buffer;
        this.offset = firstSound(buffer);
      });
    return this.loading;
  }

  /** Resolves when playback starts; `onEnd` fires when the snippet finishes or is stopped. */
  async play(seconds: number, onEnd: () => void): Promise<void> {
    await this.loading;
    if (!this.buffer) throw new Error('audio not loaded');
    this.stop();
    const ctx = this.context();
    await ctx.resume();

    const duration = Math.min(seconds, this.buffer.duration - this.offset);
    const gain = ctx.createGain();
    const t = ctx.currentTime + 0.02;
    const fade = Math.min(0.02, duration / 6);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + fade);
    gain.gain.setValueAtTime(1, t + duration - fade);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    gain.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(gain);
    src.onended = () => {
      if (this.source === src) this.source = null;
      onEnd();
    };
    src.start(t, this.offset, duration);
    this.source = src;
  }

  stop() {
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
  }
}

/** Must stay below the server's slice margin, or the snippet would come out short. */
const MAX_SILENCE_SKIP = 0.4;

function firstSound(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, buffer.sampleRate * MAX_SILENCE_SKIP);
  for (let i = 0; i < limit; i++) if (Math.abs(data[i]) > 0.02) return i / buffer.sampleRate;
  return 0;
}
