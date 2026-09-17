# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/). `0.x` releases are published with
`--tag next`; `1.0.0` follows once `/primers` is live on data.sorghumbase.org.

## [0.8.0] — 2026-09-17

### Added
- **Several restriction enzymes can be shown at once.** The digest table gained a checkbox per enzyme with **Select all** and **Select none**, and the template map carries the same as a collapsible checklist of every enzyme with a site in the template. Ticking in either place marks it in both.
- **Each enzyme has its own colour**, from the same Okabe-Ito palette the variant views use and derived from the name, so an enzyme keeps its colour as others are ticked on and off. Recognition sites are underlined in that colour in the amplicon sequence, cut marks take it too, and the map draws its sites in it. Colour is never the only channel: the table, the sequence legend and the map checklist all name the enzyme, and a base covered by more than one site names them all in its tooltip.
- `enzymeColor(name)` is exported for hosts drawing their own views.

### Changed
- `selectedEnzyme`/`onSelectEnzyme` on `PairsTable`, `PairDetail` and `TemplateMap` become `selectedEnzymes`/`onSelectEnzymes`, taking and returning a list. `DigestPanel`'s `selected` is a list and `onSelect` receives one. `AmpliconSequence`'s `sites` and `cuts` now name their enzyme (`{start, end, enzyme}` and `{position, enzyme}`), and `cutLabel` is gone since the legend names every enzyme shown. `MapSite` gained `enzyme`.
- **Select all** and **Select none** act on what is listed rather than the whole panel: in a pair's digest that means the enzymes cutting that product, on the map every enzyme with a site in the template. Ticking a hidden enzyme that shreds the amplicon would mark sites nobody asked to see.
- The digest table no longer highlights ticked rows. The checkbox and the colour swatch already say which are shown, and under **Select all** a highlight on every row says nothing.

## [0.7.0] — 2026-09-16

Narrows 0.6.0 to what it should have been. The restriction analysis of a
predicted product is about the product, not about variants inside it.

### Added
- **Recognition sites are highlighted in the amplicon sequence**, not just the cut points. Selecting an enzyme in the digest table boxes every occurrence of its site in the sequence and marks where it severs the strand; a site wrapping across a line is highlighted on both.
- **A Positions column** in the digest table, giving each site's template coordinates, so a site can be found without counting bases.
- **An enzyme picker on the template map**, listing every enzyme with a site in the template and how many. Choosing one draws its sites across the whole template and marks them in every pair's amplicon at once — the choice is shared, so picking an enzyme in a pair's details marks it on the map too.

### Changed
- The digest table is now "Restriction sites in the N bp product" and leads with the sites rather than the fragments.

### Removed
- **CAPS assays from variants inside a product**, added in 0.6.0, along with the variant track on the template map and the variant listing fetched after each design. A restriction map of an amplicon is a question about the amplicon; overlapping it with variants answered a question nobody had asked here, and the variant-based CAPS annotation on the genotyping variant table (0.5.0) is unchanged and still where that belongs.
- `capsForAmplicon`, `digestsDistinguishable` and `ProductCaps` are gone with it, as are the `variants` and `variantsUnavailable` props on `PairsTable` and `PairDetail`. `DigestPanel` takes `maxCuts` instead, and `PairsTable`/`PairDetail` take `selectedEnzyme`/`onSelectEnzyme` so a host can share the choice. `TemplateMap`'s `variants` prop is replaced by `sites`, `enzymeOptions`, `selectedEnzyme` and `onSelectEnzyme`; `MapVariant` is now `MapSite`.
- `variantOnTemplate` and `genomicToTemplatePosition` are kept: the second is the inverse of the existing `templateGenomicPosition`, and both are tested against real minus-strand and spliced templates.

## [0.6.0] — 2026-09-16

### Added
- **A restriction digest for every predicted product**, under the amplicon in the pair detail. It lists the enzymes that cut the product — fewest cuts first, since a single cutter is the one you can read — with their sites and fragment sizes, and names the enzymes that do not cut it at all, which is the check before adding a site to a primer end for cloning. Selecting an enzyme marks its cuts in the amplicon sequence above.
- **CAPS assays from ordinary primer pairs.** Where the genome has variation data, any variant inside a predicted product is listed with the enzymes that tell its alleles apart, and — unlike the annotation on a bare listing — with the actual fragment sizes for both alleles, because here the amplicon is known. A verdict of "not on a gel" always says why.
- **Variants on the template map**, coloured by consequence with a legend, ringed where a designed product genotypes them by digestion. The track appears only when there is something to draw and the map grows to fit it.
- Headless exports: `digestAmplicon`, `singleCutters`, `nonCutters`, `capsForAmplicon`, `digestsDistinguishable`, `ampliconSeq`, `variantOnTemplate`, `genomicToTemplatePosition`, and the `DigestPanel` component.

### Notes
- **This needs no host callback.** `template.seq` comes back with every design response, so the digest works in every mode including a pasted sequence — unlike the variant-listing annotation, which has no sequence of its own.
- **Whether two digests differ is the test, not whether a site is present in one allele.** That is what a gel actually reads, and it is right about the cases presence/absence gets wrong: an enzyme with a constitutive site across the variant can still gain or lose a second, and a site that merely moves changes the fragment sizes without changing the site count.
- **Coordinates are handled explicitly rather than assumed.** A minus-strand template holds the reverse complement, so alleles are complemented when placed on it and an indel is anchored at the image of its last genomic base. A spliced template omits introns, so a variant straddling a junction has no contiguous image and is refused. A pasted sequence has no genomic coordinates, and says so instead of showing an empty table.
- One variant listing is fetched per design, spanning the whole template, rather than one per pair.
- Readability defaults, all overridable: fragments below 50 bp do not run on a gel, bands within 40 bp co-migrate, and more than four cuts is not a readable ladder.

## [0.5.0] — 2026-09-16

### Added
- **A CAPS column in the variant table.** Many variants can be typed by digesting an ordinary PCR product instead of by allele-specific priming, which is cheaper and needs no labelled probes. The column says which: **CAPS** when the variant itself creates or destroys a restriction site, **dCAPS** when a deliberate mismatch in the primer would create one, **None** when nothing in the panel discriminates. Each verdict is a glyph, a colour and a word, so it reads the same without colour.
- **An enzyme filter and a CAPS-able only toggle**, beside the existing consequence, source and property filters. The enzyme menu is built from the listing and offers only enzymes that actually discriminate something in the window, with counts.
- **CAPS-able variants are ringed in the region browser**, not recoloured — colour already carries consequence there — with a matching legend key that appears only when something in view is cut.
- **`sequenceForRegion`**, a new optional prop. A variant listing carries coordinates and alleles but no bases, so reference sequence comes from the host, exactly as gene models do. Without it the column reads **Unknown** rather than **None**: that a site cannot be found is not the same claim as that none exists.
- **`enzymes`**, a new optional prop. The bundled panel of 48 widely stocked enzymes is a default, not a fixed list — what matters is what a given lab actually stocks. Recognition sequences and cut positions follow [REBASE](https://rebase.neb.com).
- The engine is exported headless: `annotateVariants`, `capsCall`, `differentialSites`, `dcapsOpportunities`, `findSites`, `digestFragments`, `isResolvable`, `iupacMatcher`, `variantContext`, `verifyWindow`, `enzymeCounts`, and the `COMMON_ENZYMES` panel with `findEnzyme`, `enzymeSpecificity` and `isSixCutter`.

### Notes
- **The sequence source must be the same release the variants come from.** A gene track from the wrong release looks wrong; sequence from the wrong release produces a confident, wrong enzyme call. Every window is therefore checked against the reference alleles the API reports, and a single disagreement marks the whole window unknown with an explanation, rather than annotating three of four rows plausibly and one wrongly.
- **Six-cutters rank above four-cutters.** Four-cutters discriminate far more variants but cut an amplicon too often for a readable gel. Ranking is by informative bases rather than site length, so an interrupted site such as `XmnI` (`GAANNNNTTC`) is correctly treated as a six-cutter and a degenerate one such as `AccI` (`GTMKAC`) as weaker than a plain six.
- **dCAPS reports the opportunity, not the primer** — the enzyme, which side of the variant the mismatch sits on, how far away and which base. Designing a primer around a deliberate mismatch needs the thermodynamics the server owns.
- **Methylation is not modelled.** Digests are computed from sequence alone, so a Dam- or Dcm-sensitive enzyme may fail on DNA this annotation calls cuttable.
- CAPS is an annotation, not a third assay type: a genotyping set is three oligos by definition, which CAPS does not fit. Nothing about designing, checking or ordering sets changes, and `/primers` is unchanged.

## [0.4.0] — 2026-09-16

### Added
- **A region browser above the variant table.** It draws gene models and the variants the table is showing, coloured by consequence with a legend, and pans and zooms independently of the listing. It is fed the table's filtered rows, so the browser and the table can never show different sets, and a variant the table will not let you select is not selectable in the browser either.
- **List this region** re-lists the table over the browsed window, and refuses a span wider than the server will accept rather than failing at the request.
- **`genesInRegion`**, a new optional prop. `/primers` has no genes-in-region endpoint — it can only fetch a gene by id — so gene models come from the host. The callback returns `RegionGene`s in genomic coordinates, which is what a region view draws and what gene sources such as Ensembl REST already return. Without the callback the browser says gene models are unavailable rather than appearing broken.
- `consequenceColor` and `consequenceLabel` are exported: a consequence keeps the same colour wherever it appears, and across sessions.

## [0.3.2] — 2026-09-16

### Added
- **Filter variants by consequence and by reporting source.** Both menus are built from the listing itself: they offer only values that are actually present, show how many rows carry each, and disable themselves when there is nothing to choose between. The source filter isolates a single EMS line in a window that spans several.
- **Property filters** for multi-allelic variants — which mismatch both allele-specific primers — and for indels that can slide, alongside the existing designable-only toggle. A **Clear filters** control appears whenever any filter is active, next to a count of the rows shown.

### Fixed
- Filtering the listing down to nothing no longer hides the filter toolbar along with the table, which had left no way to undo the filter. The empty message now distinguishes a listing filtered to nothing from a window with no variants in it.

## [0.3.1] — 2026-09-16

### Changed
- **The variant table scrolls in place**, so a window listing hundreds of variants no longer pushes the assay options and the rest of the form off the page. Its headers stay pinned while you scroll.
- **Every column sorts** — position, change, kind, ids, consequence and designability. Click a header to sort and again to reverse; equal values keep genome order. Sorting by designability brings the rows you can actually use to the top.
- **Filtering is closer to the table it affects:** the search box now sits in a toolbar directly above it, next to a **Designable only** toggle and a count of how many rows are shown. The Filters group keeps only the choices that change what the server returns (variant kinds, EMS mutations).

### Fixed
- A test that asserted nothing: every variant in the listing fixture is designable, so its "cannot be designed" check never ran.

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
