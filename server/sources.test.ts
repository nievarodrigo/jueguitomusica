import { describe, expect, it } from 'vitest';
import { QuotaError, withQuotaRetry } from './sources';

const noSleep = async () => {};

describe('withQuotaRetry', () => {
  it('retries when Deezer says the quota is exceeded, then succeeds', async () => {
    let calls = 0;
    const result = await withQuotaRetry(async () => {
      calls++;
      if (calls < 3) throw new QuotaError();
      return 'ok';
    }, noSleep);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('waits longer on each retry', async () => {
    const waits: number[] = [];
    let calls = 0;
    await withQuotaRetry(
      async () => {
        if (++calls < 3) throw new QuotaError();
        return 1;
      },
      async (ms) => void waits.push(ms),
    );
    expect(waits.length).toBe(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it('gives up after a few attempts', async () => {
    let calls = 0;
    await expect(
      withQuotaRetry(async () => {
        calls++;
        throw new QuotaError();
      }, noSleep),
    ).rejects.toBeInstanceOf(QuotaError);
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(6);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      withQuotaRetry(async () => {
        calls++;
        throw new Error('404');
      }, noSleep),
    ).rejects.toThrow('404');
    expect(calls).toBe(1);
  });
});
