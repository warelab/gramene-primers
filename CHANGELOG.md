# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/). `0.x` releases are published with
`--tag next`; `1.0.0` follows once `/primers` is live on data.sorghumbase.org.

## [0.3.0] — 2026-09-16

### Added
- **Genotyping mode (KASP and AS-PCR).** A new `genotyping` mode designs allele-specific assays for a known or hand-entered variant, checks them against the pan-genome, and reads back what allele every assembly carries. It is opt-in: pass `genotyping` in `modes` (and it needs a genome), or switch it off with `features={{ genotyping: false }}`.
  - **Choosing the variant:** browse known variants in a window (at most 50,000 bp) with filters by kind and EMS status and a text search, look one up by id, or enter one by hand in either VCF or Ensembl style. Rows that cannot be designed are listed with the reason rather than hidden. When variant lookups are switched off or unreachable the picker degrades to manual entry with a retry countdown instead of failing.
  - **Assay options:** KASP or AS-PCR, orientation, tails and dyes, deliberate mismatch and its position, how many sets to design, and how far constraints may be relaxed. Primer3 parameters are shown with the relaxation ladder and the hard floors; a parameter you set is pinned and never relaxed.
  - **Sets table:** one row per set, identified by its content key rather than its position, with the annealing sequence and the tailed order sequence copied separately, product sizes, Tm balance, neighbouring variants, quality and issue chips.
  - **Allele matrix:** genomes × sets, with the observed allele and each set's predicted dye, glyph plus colour plus text throughout, filters for disagreements and issues, and a per-genome breakdown of the orthologous copies behind a call. A withheld prediction is shown as "cannot be predicted", never as a disagreement.
  - **Orientation cards** explain why an orientation was blocked or yielded no sets, including each relaxation attempt's Primer3 explain counts.
  - **Order sheet** with the oligos to order, the KASP mix, the submission sequence, and TSV/FASTA exports plus a genotype-calls export once a check has run.
  - The check's cost is mirrored client-side, so Submit is disabled before the server would refuse an over-budget job.
- **Public headless API for genotyping:** request builders, validation, presets, results matching, exporters and the allele/prediction display metadata are all exported, alongside the new component and domain types.

### Fixed
- `features.genotyping` is now honoured; it was previously declared but never read.

## [0.2.0] — 2026-09-15

### Added
- **Primer3 help in the designer:**
  - A **?** button on each Primer3 setting (size, Tm and GC ranges, Max Tm difference, pairs to return, product size ranges, the advanced parameters and the repeat-masking choice) shows what it does, with links to its tags in the Primer3 2.6.1 manual.
  - The interval, junction and explain texts link to the Primer3 tags they map to.
  - `PairsTable` has an "About these columns" section for its statistics.
  - The results end with a credit: the Primer3 version and its citation (Untergasser et al. 2012).
  - Manual links open in a new tab.
- **Resizable form and results columns:** in the two-column layout, a splitter between them can be dragged, or moved with the arrow keys, Home and End; double-click resets it. The width is saved in `state.view.formWidth` (300 px or more, with at least 360 px left for the results).

## [0.1.1] — 2026-09-15

### Fixed
- **Inputs in `<details>` panels** (Advanced parameters, Advanced check settings) are no longer 18 px wider than their grid cells. Children of `<details>` inherit `box-sizing` through its UA shadow slot, so the stylesheet sets `border-box` on them again.
- **`npm publish --dry-run`** passes: `scripts/lint-pkg.mjs` packs with `--dry-run=false`, so its inner `npm pack` no longer inherits `npm_config_dry_run` and skips the tarball that attw reads.

### Changed
- **Playground:** `?api=live` calls `PRIMERS_API` directly when the dev server has it (e.g. `PRIMERS_API=https://data.sorghumbase.org/sorghum_v11a npm run dev`); without it, `/sorghum_v11` is still proxied to `PRIMERS_PROXY_TARGET`.

## [0.1.0] — 2026-09-13

### Added
- Package skeleton: Vite library build (ESM `dist/gramene-primers.js`, CJS
  `dist/gramene-primers.cjs`, rolled-up `index.d.ts`/`index.d.cts`,
  `gramene-primers.css`), React 18 as a peer dependency, no runtime dependencies.
- Headless client `createPrimersClient` for `POST /primers/design`,
  `GET /primers/genomes`, `POST /primers/check`, `GET /primers/check/{job_id}` and
  `GET /genes?idList=`, with `PrimersApiError` mapping (handler codes, `VALIDATION`,
  `HTTP_<status>`, `NETWORK`, `TIMEOUT`, `retryAfterMs`) and untouched `AbortError`s.
- Check polling with backoff (1 s ×1.5 → 10 s, reset on progress, ≥ 2 s while
  queued), `Retry-After` handling, bounded retries, one resubmit on 404 when allowed,
  pause while the page is hidden, and abort.
- Request builders (`buildDesignRequest`, `buildCheckRequest`), check limits and
  the server's `max_product_size` raise rule, presets mirroring the server,
  inline validation helpers, Primer3 2.6.1 explain hints, TSV/FASTA exporters with
  formula-injection protection, the CPU-cost estimate, serializable designer state
  (v1), result matching by primer sequence, pan-genome summary helpers, and
  IUPAC-aware coordinate utilities.
- Components `PrimerDesigner`, `PairsTable`, `TemplateMap`, `SpecificityResults`,
  `PangenomeMatrix` (with `PangenomeLegend`) and `GenomePicker`; `mount(el, props)`
  for hosts without React; runtime style injection (`ensureStylesInjected`,
  `STYLE_ELEMENT_ID`, `PRIMERS_CSS`) plus `gramene-primers/style.css`; light, dark
  and auto themes.
- Playground (`npm run dev`, `?api=mock|live&page=<id>&mockError=<CODE>`).
- Contract request fixtures (`npm run fixtures`), `scripts/capture-fixtures.mjs` and
  `test/components/fixtures/build-designs.mjs`.
- Check stringency of algorithm version 2:
  - check param `max_amplifying_mismatches` (0–5, default 3, below `ignore_mismatches`) in `CheckParams`, `CHECK_DEFAULTS`, `CHECK_PARAM_LIMITS`, `validateCheckParams` and the check panel ("Max mismatches per primer for a product");
  - `effectiveMaxAmplifyingMismatches`;
  - `unlikelyReason` / `unlikelyText`, so unlikely products say whether a primer has too many mismatches or mismatches near the 3′ end;
  - approximate mismatch counts are flagged.
- Pan-genome `summary.truncated`, with `truncatedGenomeCount`: a `⋯` marker on affected matrix cells, an "N incomplete" column summary, a note and a CellDetail sentence, and a `truncated` column at the end of `PANGENOME_TSV_HEADER`.
- `CleanedSequence.records` (FASTA records with sequence), shown as a Sequence-mode note, mirroring the server warning `MULTIPLE_RECORDS`.
- A re-alignment term in `estimateCheckCpu`, matching the server's `check/cost.js`:
  - `REALIGN_CPU_S_PER_PRIMER_TASK` (0.6) CPU-s per unique primer per genome task, where the tasks are the reference genome plus each pan-genome genome outside transcript mode;
  - reported as `realign_cpu_s` and `genome_tasks`;
  - `cpu_s` is rounded up ignoring float noise below 1e-6, as the server does.
- `flattenValidationErrors`, `needsJobDocument` and `availableGenomeNames`.

### Changed
- **Type rename:** the genome block of `CheckResults` is exported as `GenomeSpecificityResults`, because the name `SpecificityResults` belongs to the component.
- **`npm run lint:pkg`** now runs `scripts/lint-pkg.mjs`. It packs into a temporary directory, so it no longer deletes the `gramene-primers-0.1.0.tgz` made by `npm run pack:local`.
- **CPU estimate:** `estimateCheckCpu` now matches the server's `check/cost.js` in two ways. With the new factor, 20 primers against all 119 sorghum genomes exceed the 6,000 CPU-s limit.
  - The pan-genome BLAST term is multiplied by `PANGENOME_CPU_FACTOR` (2.0), measured on the full sorghum panel.
  - A genome of unknown size, reference or pan-genome, is charged `FALLBACK_GENOME_GB` (1 Gb).
- **`scripts/capture-fixtures.mjs`:** a check submit that is not `202` prints a warning and makes the script exit non-zero, unless `--allow-existing` is passed. A stale `<name>-running.json` is removed before polling.
- **Preview template** (`template_only`) is no longer blocked by the product-size-versus-template-length rule, which the server skips for previews.
- **`cleanSequenceInput`** treats lines starting with spaces and then `>` as headers, as the server does.

### Fixed
- **A check that already finished shows its results:** `POST /primers/check` answers an existing job without results, so `useCheckJob`, `client.runCheck` and the `pollCheckJob` resubmit path now read the job once.
- **Transcript-mode genome results** no longer say "No off-target products in the genome" above a list of off-targets.
- **Restore:** a restored `designed: true` state is re-run only when the Design button would allow it, e.g. never a sequence-mode state whose sequence was not persisted.
- **`injectStyles={false}`** on `PrimerDesigner` also applies to the result components rendered inside it.
- **Preview template** no longer drops the checked and selected pairs on the next design.
- **The validation error banner** lists the validator's nested reasons instead of the generic `INVALID_REQUEST_PARAMETER` wrapper.
- **Region mode** blocks a free-text genome name that is not a system name.
- **Client validation** mirrors the server rule that `max_size` must not exceed the smallest product size.
- **Saved pan-genome genome lists** are narrowed to the genomes the current mode can search, both in the request and in the CPU estimate.
