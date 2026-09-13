import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, downloadText } from '../src/clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

describe('copyText', () => {
  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(copyText('ACGT')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('ACGT');
  });

  it('falls back to a textarea and execCommand when the clipboard API fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    let copied = '';
    const exec = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? (document.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '';
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    await expect(copyText('GGCC')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(copied).toBe('GGCC');
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('downloadText', () => {
  it('creates a Blob URL, clicks a temporary <a download> and revokes the URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    expect(downloadText('pairs:1.tsv', 'a\tb\n', 'text/tab-separated-values')).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('text/tab-separated-values');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe('pairs_1.tsv');
    expect(clicks[0]?.getAttribute('href')).toBe('blob:mock');
    expect(document.querySelector('a[download]')).toBeNull();
    await new Promise((r) => setTimeout(r, 1));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    spy.mockRestore();
  });
});
