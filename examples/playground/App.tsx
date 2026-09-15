import { useMemo, useState } from 'react';
import { createPrimersClient, PrimerDesigner, VERSION, type PrimerDesignerState, type PrimersClient } from 'gramene-primers';
import { createMockClient, GENES } from './mockClient';
import { findPage, PAGES } from './pages';

/** `?api=live` base: the dev server's `PRIMERS_API` (called directly; the API sends CORS `*`), else `/sorghum_v11` through the dev proxy. */
export const LIVE_API_BASE = import.meta.env.PRIMERS_API || '/sorghum_v11';
type ThemeChoice = 'auto' | 'light' | 'dark';
const EXPIRED_JOB_ID = '0'.repeat(32);

export interface AppProps {
  /** `location.search`: `?api=mock|live&page=<id>&mockError=<CODE>`. */
  search?: string;
  /** Test hook: scales the mock API latencies. */
  mockDelayScale?: number;
}

/** Local playground for the designer (spec §C.7): pages, theme toggle and a controlled-state inspector. */
export function App({ search = '', mockDelayScale }: AppProps): JSX.Element {
  const params = new URLSearchParams(search);
  const api: 'mock' | 'live' = params.get('api') === 'live' ? 'live' : 'mock';
  const mockError = params.get('mockError');
  const [pageId, setPageId] = useState(findPage(params.get('page')).id);
  const [theme, setTheme] = useState<ThemeChoice>('auto');
  const [controlled, setControlled] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [states, setStates] = useState<Record<string, PrimerDesignerState | undefined>>(() => Object.fromEntries(PAGES.map((p) => [p.id, p.initialState])));
  const [events, setEvents] = useState<string[]>([]);
  const page = findPage(pageId);

  const client: PrimersClient = useMemo(
    () =>
      api === 'live'
        ? createPrimersClient({ apiBase: LIVE_API_BASE })
        : createMockClient({ variant: page.mockVariant ?? 'default', delayScale: mockDelayScale, failWith: mockError, skipQueue: mockDelayScale !== undefined && mockDelayScale < 1 }),
    // A fresh client per page and reset keeps mock errors one-shot.
    [api, page.id, page.mockVariant, mockDelayScale, mockError, epoch],
  );

  const log = (line: string) => setEvents((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 12));
  const state = states[page.id];
  const gene = api === 'mock' && page.geneId ? GENES[page.geneId] : undefined;
  const groups = [...new Set(PAGES.map((p) => p.group))];

  return (
    <div className="pg-shell">
      <nav className="pg-nav" aria-label="Playground pages">
        <h1>gramene-primers {VERSION}</h1>
        <p className="pg-note">
          API: <strong>{api}</strong> ({api === 'live' ? (LIVE_API_BASE.startsWith('/') ? `${LIVE_API_BASE} via the dev proxy` : LIVE_API_BASE) : 'fixture replay'})
        </p>
        {groups.map((group) => (
          <div key={group}>
            <h2>{group}</h2>
            <ul>
              {PAGES.filter((p) => p.group === group).map((p) => (
                <li key={p.id}>
                  <button type="button" aria-current={p.id === page.id ? 'page' : undefined} onClick={() => setPageId(p.id)}>
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="pg-main">
        <div className="pg-bar">
          <label>
            Page{' '}
            <select value={page.id} onChange={(e) => setPageId(e.target.value)}>
              {PAGES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.group}: {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Theme{' '}
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
              <option value="auto">auto</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={controlled} onChange={(e) => setControlled(e.target.checked)} /> controlled state
          </label>
          <button
            type="button"
            onClick={() => {
              setStates((prev) => ({ ...prev, [page.id]: page.initialState }));
              setEpoch((n) => n + 1);
            }}
          >
            Reset page
          </button>
          <button
            type="button"
            onClick={() => {
              const s = states[page.id] ?? page.initialState ?? { v: 1 as const, mode: page.defaultMode };
              setStates((prev) => ({ ...prev, [page.id]: { ...s, designed: true, check: { checks: ['specificity'], ...s.check, jobId: EXPIRED_JOB_ID } } }));
              setEpoch((n) => n + 1);
            }}
          >
            Restore with an expired job
          </button>
        </div>
        <p className="pg-note">{page.note}</p>
        <div className="pg-host">
          <PrimerDesigner
            key={`${page.id}:${epoch}:${controlled}`}
            apiBase={LIVE_API_BASE}
            client={client}
            gene={gene}
            geneId={page.geneId}
            systemName={page.systemName}
            region={page.region}
            sequence={page.sequence === 'mock' ? undefined : page.sequence}
            modes={page.modes ?? ['gene', 'transcript', 'region', 'sequence']}
            defaultMode={page.defaultMode}
            state={controlled ? state ?? page.initialState : undefined}
            onStateChange={(s) => setStates((prev) => ({ ...prev, [page.id]: s }))}
            onDesign={(res) => log(`design: ${res.pairs.length} pairs, template ${res.template.length} bp`)}
            onCheckUpdate={(job) => log(`check ${job.job_id.slice(0, 8)}: ${job.status}${job.progress ? ` ${job.progress.done}/${job.progress.total}` : ''}`)}
            onError={(e) => log(`error ${e.code}: ${e.message}`)}
            geneHref={(id) => `?api=${api}&page=${page.id}#gene=${encodeURIComponent(id)}`}
            geneLabel={page.geneId}
            theme={theme}
            persistSequence={false}
          />
        </div>
        <section aria-labelledby="pg-inspector-h">
          <div className="pg-inspector-bar">
            <h2 id="pg-inspector-h" style={{ fontSize: '1rem', margin: 0 }}>
              Controlled state ({controlled ? 'host-owned' : 'uncontrolled; last emitted'})
            </h2>
          </div>
          <pre className="pg-inspector" data-testid="pg-state">
            {JSON.stringify(state ?? null, null, 2)}
          </pre>
          <h2 style={{ fontSize: '1rem', margin: '0.5rem 0 0' }}>Events</h2>
          <pre className="pg-inspector" data-testid="pg-events">
            {events.join('\n') || '—'}
          </pre>
        </section>
      </main>
    </div>
  );
}
