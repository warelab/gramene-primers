import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAlleleFrequencies } from '../../src/components/hooks/useAlleleFrequencies';
import type { AlleleFrequencies, PopulationFrequency } from '../../src/types';

const rows = (allele: string): PopulationFrequency[] => [
  { population: 'SAP', allele, frequency: 0.3, count: 10 },
  { population: 'SAP', allele: 'X', frequency: 0.7, count: 20 },
];

/** Renders the hook and reports its state as text. */
function Probe(p: {
  fetchFrequencies?: AlleleFrequencies;
  ids: string[];
  batchSize?: number;
  maxAnnotated?: number;
}): JSX.Element {
  const s = useAlleleFrequencies(p.fetchFrequencies, 'sorghum_bicolor', p.ids, {
    batchSize: p.batchSize,
    maxAnnotated: p.maxAnnotated,
    debounceMs: 0,
  });
  return (
    <div>
      <span data-testid="annotated">{s.byId.size}</span>
      <span data-testid="flags">{`${s.loading ? 'loading' : ''}|${s.done ? 'done' : ''}|${s.capped ? 'capped' : ''}|${s.unsupported ? 'unsupported' : ''}`}</span>
      <span data-testid="error">{s.error ? 'error' : ''}</span>
    </div>
  );
}

const ids = (n: number, prefix = 'v') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const annotated = () => Number(screen.getByTestId('annotated').textContent);
const flags = () => screen.getByTestId('flags').textContent ?? '';

describe('useAlleleFrequencies', () => {
  it('asks in batches of the given size, never more than two at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const sizes: number[] = [];
    const fetchFrequencies = vi.fn(async (q: { ids: string[] }) => {
      sizes.push(q.ids.length);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return Object.fromEntries(q.ids.map((id) => [id, rows('A')]));
    });
    render(<Probe fetchFrequencies={fetchFrequencies} ids={ids(10)} batchSize={3} />);
    await waitFor(() => expect(flags()).toContain('done'));
    expect(sizes).toEqual([3, 3, 3, 1]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(annotated()).toBe(10);
  });

  it('stops at the cap and says so, rather than pulling the whole listing', async () => {
    const fetchFrequencies = vi.fn(async (q: { ids: string[] }) =>
      Object.fromEntries(q.ids.map((id) => [id, rows('A')])),
    );
    render(<Probe fetchFrequencies={fetchFrequencies} ids={ids(50)} batchSize={10} maxAnnotated={20} />);
    await waitFor(() => expect(flags()).toContain('done'));
    expect(annotated()).toBe(20);
    expect(flags()).toContain('capped');
    expect(fetchFrequencies.mock.calls.flatMap((c) => c[0].ids)).toHaveLength(20);
  });

  it('remembers an id with no frequency, so it is not asked for again', async () => {
    // The source answers about only some of what it is asked.
    const fetchFrequencies = vi.fn(async (q: { ids: string[] }) => ({ [q.ids[0]!]: rows('A') }));
    const { rerender } = render(<Probe fetchFrequencies={fetchFrequencies} ids={ids(4)} batchSize={4} />);
    await waitFor(() => expect(flags()).toContain('done'));
    expect(annotated()).toBe(4);
    expect(fetchFrequencies).toHaveBeenCalledTimes(1);

    // Re-rendering with the same ids asks for nothing at all.
    rerender(<Probe fetchFrequencies={fetchFrequencies} ids={ids(4)} batchSize={4} />);
    await waitFor(() => expect(flags()).toContain('done'));
    expect(fetchFrequencies).toHaveBeenCalledTimes(1);
  });

  it('asks only for ids it does not already hold', async () => {
    const fetchFrequencies = vi.fn(async (q: { ids: string[] }) =>
      Object.fromEntries(q.ids.map((id) => [id, rows('A')])),
    );
    const { rerender } = render(<Probe fetchFrequencies={fetchFrequencies} ids={ids(3)} batchSize={10} />);
    await waitFor(() => expect(flags()).toContain('done'));
    expect(fetchFrequencies.mock.calls[0]![0].ids).toEqual(['v0', 'v1', 'v2']);

    rerender(<Probe fetchFrequencies={fetchFrequencies} ids={[...ids(3), 'v3', 'v4']} batchSize={10} />);
    await waitFor(() => expect(annotated()).toBe(5));
    // Only the two new ones.
    expect(fetchFrequencies.mock.calls[1]![0].ids).toEqual(['v3', 'v4']);
  });

  it('reports a failure without pretending the rows have no frequency', async () => {
    const fetchFrequencies = vi.fn(async () => {
      throw new Error('upstream down');
    });
    render(<Probe fetchFrequencies={fetchFrequencies} ids={ids(2)} />);
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('error'));
    expect(flags()).not.toContain('done');
    expect(annotated()).toBe(0);
  });

  it('swallows an abort, which is the window moving on', async () => {
    const fetchFrequencies = vi.fn(async (_q, o?: { signal?: AbortSignal }) => {
      await new Promise((r) => setTimeout(r, 20));
      if (o?.signal?.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return {};
    }) as unknown as AlleleFrequencies;
    const { rerender, unmount } = render(<Probe fetchFrequencies={fetchFrequencies} ids={ids(2, 'a')} />);
    rerender(<Probe fetchFrequencies={fetchFrequencies} ids={ids(2, 'b')} />);
    unmount();
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByTestId('error')).toBeNull();
  });

  it('says so when the host has no frequency source, and asks for nothing', () => {
    render(<Probe ids={ids(5)} />);
    expect(flags()).toContain('unsupported');
    expect(annotated()).toBe(0);
  });
});
