# gramene-primers

PCR/qPCR primer design for Gramene sites (SorghumBase first), as an embeddable React
component plus a headless TypeScript client. It talks to the gramene-swagger `/primers`
endpoints:

- **Design:** Primer3 2.6.1 on a gene (± flanks), a spliced transcript (junction-spanning qPCR), a genomic region or a pasted sequence, optionally avoiding repeats.
- **Genome specificity:** a Primer-BLAST-style check against the reference genome, and against its transcriptome in transcript mode.
- **Pan-genome coverage:** the same check across every assembly of the species.

- React 18 is a peer dependency; the package has **no runtime dependencies**.
- ESM + CJS builds with TypeScript declarations; styles are injected at runtime and also shipped as `gramene-primers/style.css`.

> Status: `0.1.1`. The API endpoints are under development on the
> gramene-swagger `primer-design` branch. Check results follow check algorithm version 2.

## Install

```bash
npm install gramene-primers react@^18.2 react-dom@^18.2
```

During development, link a tarball rather than `npm link` (a symlink would load a second React):

```bash
npm run pack:local                       # gramene-primers-0.1.1.tgz
cd ../gramene-search && npm install --no-save ../gramene-primers/gramene-primers-0.1.1.tgz && rm -rf .parcel-cache
```

`npm run lint:pkg` packs into a temporary directory, so it never deletes that tarball, whichever runs last.

## PrimerDesigner

```jsx
import { PrimerDesigner } from 'gramene-primers';

<PrimerDesigner
  key={gene._id}
  apiBase="https://data.sorghumbase.org/sorghum_v11"
  gene={gene}                      // Gramene gene doc; or geneId, systemName+region, sequence
  systemName={gene.system_name}
  modes={['gene', 'transcript', 'region', 'sequence']}
  state={saved} onStateChange={save} persistSequence={false}
  geneHref={(id) => `?idList=${encodeURIComponent(id)}`}
/>;
```

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `apiBase` | `string` | required | Base URL including the swagger basePath, e.g. `https://data.sorghumbase.org/sorghum_v11` |
| `client` | `PrimersClient` | `createPrimersClient({apiBase})` | Supply your own (custom `fetch`, headers, a test double) |
| `gene` | `GrameneGene` | | Enables Gene and Transcript modes and prefills Region |
| `geneId` | `string` | | Without a doc; fetched with `GET /genes?idList=` |
| `systemName` | `string` | the gene's | Reference genome; enables Region mode |
| `region` | `{region, start, end, strand?}` | the gene location | Region prefill |
| `sequence` | `string` | | Sequence-mode prefill |
| `modes` | `DesignMode[]` | all four | Offered modes; a mode without its inputs is hidden |
| `defaultMode`, `defaultParams` | | | Initial mode and Primer3 parameter overrides |
| `state`, `onStateChange` | `PrimerDesignerState` | uncontrolled | Controlled, JSON-serializable `{v: 1, …}` state |
| `persistSequence` | `boolean` | `true` | `false` keeps the pasted sequence out of emitted state (it survives only while mounted) |
| `onDesign(res, req)`, `onCheckUpdate(job)`, `onError(err)` | | | `err` is a `PrimersApiError` |
| `features` | `{check, pangenome, export, map}` | each `true` | |
| `geneHref(id, systemName?)`, `onGeneClick(id, systemName?)` | | | Gene links in results; `onGeneClick` handles plain left clicks, modified clicks follow `geneHref` |
| `geneLabel` | `string` | gene name or id | Used in export file names and FASTA headers |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | `auto` follows `prefers-color-scheme` |
| `className`, `style` | | | On the `.gpr-root` element |
| `injectStyles` | `boolean` | `true` | See [Styles](#styles) |
| `poll` | `{initialDelayMs, maxDelayMs, factor}` | 1000, 10000, 1.5 | Check polling |

### State, identity and restore

- **Identity** is `gene._id ?? geneId ?? systemName+region ?? hash(sequence)`. A change aborts the running design and polling and resets the state, unless the host passed a new `state` in the same render. Hosts should also pass `key`.
- **State** holds inputs, selections and `check.jobId`, never responses or results. `normalizeDesignerState` reads saved state tolerantly (invalid fields are dropped or clamped).
- **Restore:** `designed: true` re-runs the design once, but only when the restored inputs pass the same checks as the **Design primers** button. A sequence-mode state saved with `persistSequence={false}` has no sequence, so nothing is sent and the form waits for a paste.
- **Saved check:** `check.jobId` is read once. A queued or running job is polled, a finished one rendered, and a 404 shows "Results expired — Re-run check" (never an automatic resubmit).
- **Preview template** sends `template_only`. The server does not compare the product size ranges with the template length for a preview, so that rule blocks only **Design primers**.
- **Checks:** results are matched to pairs by UPPERCASE primer sequence, not by rank. Check job ids are shared: when `POST /primers/check` answers with a job that already finished (status only, no results), the job is read once with `GET`.
- **Pasted FASTA:** several records are joined into one template; the Sequence input notes it (server warning `MULTIPLE_RECORDS`).

## Other components

Each takes `theme`, `injectStyles`, `className` and `style` (`StyleProps`). Used on their own they render a `.gpr-root`; inside a `PrimerDesigner` they share the designer's.

| Component | Main props |
|---|---|
| `PairsTable` | `pairs`, `template?`, `checkedRanks?` + `onCheckedChange?` (check boxes), `selectedRank?` + `onSelect?`, `check?` (a job: verdict chips), `submitted?`, `label?`, `caption?` |
| `TemplateMap` | `template`, `pairs?`, `selectedRank?`, `onSelect?`, `target?`, `included?`, `excluded?`, `title?` |
| `SpecificityResults` | `results`, `block` (`'genome'` or `'transcriptome'`), `pairs?`, `job?`, `submitted?`, `systemName?`, `geneHref?`, `onGeneClick?`, `maxRows?` (100) |
| `PangenomeMatrix` | `results` (`PangenomeResults`), `requestedGenomes?` (pending rows), `genomes?` (display names), `params?` (`results.params`), `pairLabels?`, `transcriptModelsOnly?`, `geneHref?`, `onGeneClick?`, `caption?`; plus `PangenomeLegend` |
| `GenomePicker` | `genomes`, `mode`, `systemName?`, `selected?` (`null` = all), `onChange(list \| undefined)`, `disabled?`, `label?` |

Reading check results (algorithm version 2):

- **Amplifying products:** a product counts only when each primer has at most `max_amplifying_mismatches` mismatches (default 3) and passes the Primer-BLAST 3′ rule. Other products are `unlikely`.
- **Unlikely products** are listed with `include_unlikely`, and the table says why: "a primer has more than 3 mismatches" or "mismatches near the 3′ end". A pan-genome genome with only unlikely products is `no_amplicon`, and CellDetail names its closest product.
- **Approximate counts:** mismatch counts taken from BLAST alignments (cDNA hits) are marked approximate.
- **Pan-genome caps:** a genome whose search hit a site, candidate or re-alignment cap is `truncated`, and its status is a lower bound. The matrix marks that cell `⋯`, the column header shows "N incomplete", a note explains the marker, and CellDetail says products may have been missed. The data is in `summary.truncated` and in the TSV `truncated` column.
- **Transcript mode:** the genome block has no on-target product. Products inside the gene are genomic DNA products; the rest are off-targets.

## Styles

- **Injection:** the stylesheet is injected once per document as `<style id="gramene-primers-styles">` at the start of `<head>`, so host rules of equal specificity win. `PrimerDesigner` and each standalone component inject it. Components rendered inside a `PrimerDesigner` never inject on their own; the designer's `injectStyles` decides.
- **CSP-strict pages** (no `'unsafe-inline'` in `style-src`): pass `injectStyles={false}` to every top-level component and import the file instead:
  ```js
  import 'gramene-primers/style.css';   // dist/gramene-primers.css
  ```
- **`ensureStylesInjected(target?)`** injects into `document` or a `ShadowRoot`. It returns `true` when it added the element and is safe outside browsers. `STYLE_ELEMENT_ID` and `PRIMERS_CSS` (the text) are exported too.
- **Scoping:** every rule sits under `.gpr-root`, with `gpr-` class names and `--gpr-*` custom properties and no `!important`. A defensive reset beats the Bootstrap 4 reboot. Themes are `.gpr-theme-light`, `.gpr-theme-dark` and `auto`; the layout uses two columns at a container width of 960 px or more.

## mount (hosts without React)

```js
import { mount, ensureStylesInjected } from 'gramene-primers';

const handle = mount('#primers', { apiBase, geneId: 'SORBI_3001G000200', onStateChange: save });
handle.update({ theme: 'dark' });   // merges props and re-renders
handle.unmount();                   // aborts design and polling requests and empties the element

// Inside a shadow root:
const shadow = host.attachShadow({ mode: 'open' });
ensureStylesInjected(shadow);
mount(shadow.appendChild(document.createElement('div')), { apiBase, gene, injectStyles: false });
```

`mount(el, props)` takes an element or a selector and throws when nothing matches. React and ReactDOM 18 must still be installed, since they are peer dependencies.

## Headless API

```ts
import {
  createPrimersClient, buildDesignRequest, buildCheckRequest, initialDesignerState,
  matchCheckResults, estimateCheckCpu, pairsToTSV, isAbortError, PrimersApiError,
} from 'gramene-primers';

const client = createPrimersClient({ apiBase: 'https://data.sorghumbase.org/sorghum_v11' });

const gene = await client.getGene('SORBI_3001G000200');
const state = initialDesignerState({ gene, defaultMode: 'transcript' });
const design = await client.design(buildDesignRequest(state, { gene }));

const request = buildCheckRequest({
  mode: 'transcript', systemName: gene.system_name, geneId: gene._id,
  transcriptId: design.template.transcript_id, pairs: design.pairs.slice(0, 2),
});
const job = await client.runCheck(request, { onUpdate: (j) => console.log(j.status, j.progress) });
const byPair = matchCheckResults(design.pairs, job);   // matched by UPPERCASE primer sequence
```

### Client

| Method | Endpoint | Notes |
|---|---|---|
| `design(req, {signal})` | `POST /primers/design` | 60 s timeout |
| `listGenomes(systemName)` | `GET /primers/genomes?system_name=` | memoized per genome, evicted on error |
| `submitCheck(req)` | `POST /primers/check` | `created: true` for 202, `false` for an existing job (200); the answer has status and progress only |
| `getCheck(jobId)` | `GET /primers/check/{job_id}` | the job document, with `request` and `results` |
| `pollCheck(jobId, opts)` | | resolves at `done` or `error` |
| `runCheck(req, opts)` | | submit (reading an already finished job once), then poll; resubmits once if the job expires |
| `getGene(geneId)` | `GET /genes?idList=` | `null` when unknown |

Transport rules:
- Every request sends `Accept: application/json` and uses `cache: 'no-store'`, `credentials: 'omit'` and `mode: 'cors'`.
- Path and query values are URI-encoded, and no other query parameters are ever added.

Failures reject with `PrimersApiError {status, code, message, details, errors, retryAfterMs}`:

| Response | `code` |
|---|---|
| Handler error `{message, code, details}` | the server's code, e.g. `UNKNOWN_GENE`, `BUSY`, `JOB_TOO_LARGE`, `INVALID_PARAMS` |
| Swagger validator 400 `{message, errors}` | `VALIDATION`; `errors[]` is the validator's list, and `flattenValidationErrors(errors)` returns the nested reasons (e.g. `OBJECT_ADDITIONAL_PROPERTIES`, `PATTERN` with the body path) |
| Non-JSON body (e.g. an HTML 502) | `HTTP_<status>` |
| Network failure / client timeout | `NETWORK` / `TIMEOUT` (status 0) |

`retryAfterMs` comes from `details.retry_after_s`, then the `Retry-After` header. Aborted
requests reject with the original `AbortError` (test with `isAbortError`).

### Polling

Polling starts after 1 s and grows ×1.5 per poll up to 10 s:
- It resets when `progress.done` changes and waits at least 2 s while the job is queued.
- 503, other 5xx, `NETWORK` and `TIMEOUT` errors sleep `retryAfterMs` (or the current delay); polling gives up after 5 consecutive errors.
- On 404 it throws `UNKNOWN_JOB`, unless `resubmit` is given, in which case it resubmits once.
- A finished job from `submitCheck` (as `initialJob`, or after a resubmit) is read once with `getCheck` (`needsJobDocument`).
- It pauses while the document is hidden and stops on `signal` abort.

All of these are tunable through `PollOptions`.

### Check parameters

`buildCheckRequest` sends only the values that differ from these defaults; `validateCheckParams` mirrors the server.

| Param | Range | Default | Meaning |
|---|---|---|---|
| `max_product_size` | 50–10,000 | 4000 | Largest product called; raised to cover `expected` products (`checkMaxProductSize`) |
| `ignore_mismatches` | 3–6 | 6 | A primer site with this many mismatches is dropped |
| `max_amplifying_mismatches` | 0–5 | 3 | A product amplifies only when each primer has at most this many; must be below `ignore_mismatches`. When omitted, the server lowers the default to `ignore_mismatches − 1` (`effectiveMaxAmplifyingMismatches`) |
| `min_total_mismatches` | 0–6 | 2 | With `min_3p_mismatches`: the Primer-BLAST 3′ rule for `unlikely` |
| `min_3p_mismatches` | 1–5 | 2 | Mismatches required inside the 3′ window |
| `three_prime_window` | 3–10 | 5 | Bases from the 3′ end |
| `include_unlikely` | boolean | `false` | Also list `unlikely` products |
| `repeat_site_threshold` | 1–100 | 5 | More near-perfect sites than this flags a primer `repetitive` |

A saved pan-genome genome list is narrowed to the genomes the check can search in its mode (a cDNA database in transcript mode). When none remain, `buildCheckRequest` throws `CheckRequestError('NO_GENOMES')`.

### Cost estimate

`estimateCheckCpu` mirrors the server's `check/cost.js` and is used for display and to disable Submit above 6000 CPU-s:

```
cpu_s = uniq_primers × [ ref_Gb × c(5) + (transcript ? 0.15 × c(5) : 0)
                         + PANGENOME_CPU_FACTOR × Σ_pan (genome_Gb | 0.15) × c(6)
                         + genome_tasks × REALIGN_CPU_S_PER_PRIMER_TASK ]
c = {5: 5.2, 6: 2.2, 7: 1.2} CPU-s per primer·Gb; PANGENOME_CPU_FACTOR = 2.0; REALIGN_CPU_S_PER_PRIMER_TASK = 0.6;
genome_tasks = 1 + (transcript ? 0 : pan-genome genomes)   (cDNA searches re-align from the BLAST alignment)
unknown genome sizes (reference or pan-genome) count as FALLBACK_GENOME_GB = 1 Gb
```

- `PANGENOME_CPU_FACTOR` accounts for pan-genome genomes being searched by up to 8 concurrent blastn processes, which used about twice the single-thread CPU on the full sorghum panel. As a result, 20 primers against all 119 sorghum genomes exceed the limit.
- `cpu_s` is rounded up, ignoring float noise below 1e-6 as the server does.
- The result also reports `realign_cpu_s` and `genome_tasks`.

### Helpers

| Export | Purpose |
|---|---|
| `buildDesignRequest(state, ctx)` | Mode-specific body; only params that differ from the mode's server preset |
| `buildCheckRequest(input)` | Pair ids `P{rank+1}`; `expected` only in gene/region modes; genomes narrowed to searchable ones and omitted when all are selected; throws `CheckRequestError` |
| `availableGenomeNames(genomes, mode, systemName)`, `defaultPangenomeGenomes` | Genomes a pan-genome check can search |
| `isCheckablePrimer`, `pairCheckability`, `CHECK_LIMITS` | 15–36 nt ACGT primers, ≤ 10 pairs / 20 unique primers, products ≤ 10 kb |
| `checkMaxProductSize(req)` | Mirrors the server raise of `max_product_size` to `min(10000, ceil(1.2 × largest expected))` |
| `PRESETS`, `PRIMER3_DEFAULTS`, `CHECK_DEFAULTS`, `CHECK_PARAM_LIMITS` | Server presets `pcr` / `qpcr` and defaults |
| `validateDesignParams`, `validateIntervals`, `validateCheckParams`, `cleanSequenceInput` | Inline validation mirroring the server (including `max_size` ≤ the smallest product size, and the FASTA `records` count) |
| `EXPLAIN_HINTS`, `explainRows`, `summarizeExplain` | Primer3 2.6.1 explain labels → hints (shown on `NO_PAIRS`) |
| `pairsToTSV`, `primersToFasta`, `ampliconsToFasta`, `offTargetsToTSV`, `pangenomeToTSV` | Exports; TSV cells are protected against spreadsheet formula injection |
| `copyText`, `downloadText` | Clipboard with textarea fallback; Blob downloads |
| `estimateCheckCpu`, `REALIGN_CPU_S_PER_PRIMER_TASK` | CPU estimate (limit 6000 CPU-s) |
| `initialDesignerState`, `normalizeDesignerState`, `toPersistedState`, `designerIdentity` | Serializable v1 state and identity |
| `matchCheckResults`, `unlikelyReason`, `unlikelyText` | Results by sequence; why a product is `unlikely` |
| `summarizePangenome`, `truncatedGenomeCount`, `pangenomeRows`, `PANGENOME_STATUS_META` | Pan-genome matrix data (`amplifies = single_perfect + single_mismatch + multiple`; `truncated` is a flag, not a status) |
| `revcomp`, `transcriptLayout`, `cdnaToGenomicBlocks`, `mismatchIndexes`, `formatGenomic` | IUPAC-aware, case-preserving coordinates (1-based, inclusive) |

### Types

The API types (`DesignRequest`, `DesignResponse`, `CheckRequest`, `CheckParams`, `CheckJob`, `CheckResults`, `PangenomeSummary`, …) are exported by name.

The genome block of `CheckResults` (`CheckResults['specificity']`) is exported as **`GenomeSpecificityResults`**, because `SpecificityResults` is the component:

```ts
import { SpecificityResults, type GenomeSpecificityResults } from 'gramene-primers';
```

## Development

```bash
npm install
npm run typecheck
npm test                  # vitest + jsdom unit and component tests
npm run build             # dist/gramene-primers.{js,cjs,css}, dist/index.d.{ts,cts}
npm run lint:pkg          # publint + @arethetypeswrong/cli on a tarball packed in a temp dir
npm run pack:local        # build, then gramene-primers-0.1.1.tgz
npm run fixtures          # contract request fixtures (below)
npm run dev               # playground on :5174
```

### Playground

`npm run dev` serves `examples/playground` on http://localhost:5174 (strict port), with `gramene-primers` resolved to `src/`. From a workstation: `ssh -L 5174:localhost:5174 squam.cshl.edu`.

| URL parameter | Values |
|---|---|
| `api` | `mock` (default) replays real design fixtures and simulates check jobs (queued → running with partial results → done); `live` uses the real client against `PRIMERS_API` when the dev server has it (e.g. `PRIMERS_API=https://data.sorghumbase.org/sorghum_v11a npm run dev`, called directly), else against `/sorghum_v11`, proxied to `PRIMERS_PROXY_TARGET` (default `http://localhost:50111`) |
| `page` | `gene-000200` (default), `gene-000700`, `transcript-87700`, `transcript-46200`, `region`, `sequence`, `check-p1-p3`, `check-p5l`, `check-qpcr` |
| `mockError` | Mock only: the first matching request fails with this code. `BUSY`, `VALIDATION`, `FEATURE_DISABLED`, `PRIMER3_UNAVAILABLE` apply to design; `QUEUE_FULL`, `JOB_TOO_LARGE` and any other code (as a 503) apply to the check |

Example: `http://localhost:5174/?api=mock&page=check-p1-p3&mockError=QUEUE_FULL`. The toolbar switches page and theme, toggles controlled state, resets the page, and restores the page with an expired job. The inspector shows the emitted state and the event log.

### Fixtures

- `npm run fixtures` (`test/fixtures.gen.test.ts`) writes builder output for every mode to `test/fixtures/contract/requests/`:
  - `design-*.json` files are `POST /primers/design` bodies; `check-*.json` files are `POST /primers/check` bodies.
  - `test/fixtures/contract/manifest.json` lists each file with its swagger definition.
  - Copy the requests into gramene-swagger `test/primers/fixtures/contract/requests/` (remove stale files there first). `contract.test.js` validates them with sway; `PRIMERS_CONTRACT_FIXTURES=<dir>` points that test at another directory.
- `node scripts/capture-fixtures.mjs` stores real API responses in `test/fixtures/api/` for component tests and the playground.
  - It needs `PRIMERS_IT_BASE=http://localhost:50111/sorghum_v11`.
  - Add `--checks` to include finished check jobs (BLAST on the server), or `--only name[,name]` for some captures.
  - A check submit that is not `202` prints a warning and makes the script exit non-zero. This happens when the deterministic job already exists, for example after `npm run test:it`. Delete the job from the dev store or pass `--allow-existing`.
  - A stale `<name>-running.json` is removed before polling.
  - Each file is `{captured_at, base, method, path, request, status, headers, body}`. It refuses to run against production.
- `node test/components/fixtures/build-designs.mjs` regenerates `test/components/fixtures/designs/*.json` (real Primer3 designs verified against the genome). It needs fastaIdx (`PRIMERS_FASTAIDX`, default `http://localhost:8888`) and `primer3_core` (`PRIMER3_CORE`), so it runs on squam only.
- `test/fixtures/genes/` and `test/fixtures/sequences/` hold real SorghumBase v11 gene docs and sequence. Every coordinate in `test/fixtures/samples.ts` was verified against the genome.

### Integration tests (opt-in)

```bash
PRIMERS_IT_BASE=http://localhost:50111/sorghum_v11 npm run test:it          # live design/genomes/errors
PRIMERS_IT_BASE=… PRIMERS_IT_CHECKS=1 npm run test:it                      # plus one BLAST check job
PRIMERS_FASTAIDX=http://localhost:8888 npm run test:it                     # coordinates vs genome sequence
```

## License

Apache-2.0 (see [LICENSE](LICENSE)).
