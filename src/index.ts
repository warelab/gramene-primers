// gramene-primers public API.

// ---- components ---------------------------------------------------------------
export {
  AgreementMark,
  AlleleChip,
  AlleleLegend,
  AlleleMatrix,
  ManualVariantInputs,
  GenotypingPanel,
  OrderSheet,
  OrientationExplain,
  VariantBrowser,
  VariantPicker,
  AssayOptions,
  GenotypeChip,
  PredictionChip,
  PrimerStatusChip,
  PrimerDesigner,
  PairsTable,
  SetsTable,
  SetDetail,
  TemplateMap,
  SpecificityResults,
  PangenomeMatrix,
  PangenomeLegend,
  GenomePicker,
  MASK_SOURCE_LABELS,
  VERDICT_META,
  WARNING_TEXT,
  buildMatrixRows,
  designRequestFor,
  designerReducer,
  expectedMaskSource,
  genomeAvailability,
  niceTicks,
  packPairLanes,
} from './components';
export type {
  DesignerAction,
  GenomePickerProps,
  AlleleMatrixProps,
  ManualVariant,
  ManualVariantInputsProps,
  GenotypingPanelProps,
  OrderSheetProps,
  OrientationExplainProps,
  VariantBrowserProps,
  VariantPickerProps,
  AssayOptionsProps,
  GenotypeChipProps,
  MatrixCell,
  MatrixRow,
  PairsTableProps,
  SetDetailProps,
  SetsTableProps,
  PangenomeMatrixProps,
  SpecificityResultsProps,
  StyleProps,
  TemplateMapProps,
  Theme,
  VerdictChipValue,
} from './components';
export { mount } from './mount';
export type { MountHandle } from './mount';
export { ensureStylesInjected, STYLE_ELEMENT_ID, PRIMERS_CSS } from './styles/inject';

// ---- headless: client ------------------------------------------------------
export { createPrimersClient, DEFAULT_TIMEOUTS, parseRetryAfter, toApiError } from './client';
export { PrimersApiError, isAbortError, isPrimersApiError, isRetryableError, flattenValidationErrors } from './errors';
export type { PrimersApiErrorInit } from './errors';
export { pollCheckJob, DEFAULT_POLL, isTerminalJob, needsJobDocument, nextPollDelay } from './poll';

// ---- headless: requests, presets, validation --------------------------------
export {
  availableGenomeNames,
  buildDesignRequest,
  buildCheckRequest,
  changedDesignParams,
  changedCheckParams,
  checkMaxProductSize,
  checkPairId,
  checkSelectionSummary,
  canAddPairToCheck,
  CheckRequestError,
  CHECK_LIMITS,
  CHECK_PARAM_LIMITS,
  validateCheckParams,
  effectiveMaxAmplifyingMismatches,
  defaultPangenomeGenomes,
  isCheckablePair,
  isCheckablePrimer,
  pairCheckability,
  regionFromGene,
  uniquePrimers,
} from './request';
export type { BuildCheckRequestInput, CheckRequestErrorCode, DesignContext, MaxProductSizeInfo, PairCheckability, CheckSelectionSummary } from './request';
export { buildGenotypingRequest, buildGenotypingCheckRequest, GENOTYPING_CHECK_LIMITS } from './request';
export type { BuildGenotypingCheckInput, GenotypingRequestContext } from './request';
export { PRESETS, PRIMER3_DEFAULTS, CHECK_DEFAULTS, defaultPresetFor, presetParams, effectiveDesignParams } from './presets';
export type { PresetDefinition } from './presets';
export {
  GENOTYPING_FLOORS,
  GENOTYPING_LADDER,
  GENOTYPING_LEVEL0_PARAMS,
  GENOTYPING_PRESETS,
  changedGenotypingAssay,
  changedGenotypingParams,
  defaultGenotypingAssay,
  effectiveGenotypingAssay,
} from './presets';
export type { GenotypingPresetDefinition } from './presets';
export {
  DESIGN_LIMITS,
  DESIGN_PARAM_LIMITS,
  NUMERIC_DESIGN_PARAM_KEYS,
  validateDesignParams,
  validateInterval,
  validateIntervals,
  cleanSequenceInput,
} from './validate';
export type { CleanedSequence, ParamLimit, ValidateParamsContext, ValidationIssue } from './validate';
export {
  GENOTYPING_LIMITS,
  GENOTYPING_NUMERIC_PARAM_KEYS,
  GENOTYPING_PARAM_LIMITS,
  VARIANT_ALLELE_PATTERN,
  effectiveMinProductSize,
  validateGenotypingParams,
  validateVariantInput,
} from './validate';
export { EXPLAIN_HINTS, explainRows, parseExplainString, summarizeExplain } from './explain';
export type { ExplainHint, ExplainRow, ExplainSummaryItem } from './explain';

// ---- headless: results, exporters, cost, state, coordinates ----------------
export { matchCheckResults, pairKey, submittedPairs, isRepetitivePrimer, unlikelyReason, unlikelyText } from './results';
export type { MatchedCheckResults, PairCheckResult, UnlikelyReason } from './results';
export { genotypingSetTriple, designSetTriple, matchGenotypingResults, submittedGenotypingSets } from './results';
export type { GenotypingSetMatch, MatchedGenotypingResults } from './results';
export {
  ALLELE_META,
  PREDICTION_META,
  PRIMER_STATUS_META,
  alleleMatrixRows,
  alleleMeta,
  emptyGenotypeSetSummary,
  emptyGenotypeSummary,
  isConsistentGenotypeSummary,
  isDisagreement,
  isIssueAllele,
  isIssuePrediction,
  predictionMeta,
  primerStatusMeta,
  summarizeGenotypeGenomes,
} from './genotyping';
export type { AlleleMatrixCell, AlleleMatrixRow, GenotypeStatusMeta } from './genotyping';
export {
  PANGENOME_STATUS_META,
  PANGENOME_STATUSES,
  PANGENOME_TRANSCRIPT_MODELS_ONLY,
  amplifiesFraction,
  emptyPangenomeSummary,
  isConsistentSummary,
  isIssueStatus,
  isTranscriptModelsOnly,
  pangenomeCellText,
  pangenomeRows,
  sortPangenomeRows,
  summarizePangenome,
  truncatedGenomeCount,
} from './pangenome';
export type { PangenomeRow, PangenomeStatusMeta } from './pangenome';
export {
  pairsToTSV,
  primersToFasta,
  ampliconsToFasta,
  offTargetsToTSV,
  pangenomeToTSV,
  tsvCell,
  toTSV,
  PAIRS_TSV_HEADER,
  OFF_TARGETS_TSV_HEADER,
  PANGENOME_TSV_HEADER,
} from './exporters';
export type { FastaOptions, PairsExportOptions } from './exporters';
export { genotypeCallsToTSV, orderRowsToFasta, orderSheetToTSV, GENOTYPE_CALLS_TSV_HEADER, ORDER_TSV_HEADER } from './exporters';
export type { OrderSheetOptions } from './exporters';
export { copyText, downloadText } from './clipboard';
export { estimateCheckCpu, CPU_S_PER_PRIMER_GB, CDNA_GB_ESTIMATE, MAX_JOB_CPU_S, REFERENCE_WORD_SIZE, PANGENOME_WORD_SIZE, REALIGN_CPU_S_PER_PRIMER_TASK, PANGENOME_CPU_FACTOR, FALLBACK_GENOME_GB } from './cost';
export type { CheckCpuEstimate, CheckCpuInput, WordSize } from './cost';
export { GENOTYPE_CPU_S_PER_GENOME } from './cost';
export { CONSEQUENCE_PALETTE, consequenceColor, consequenceLabel } from './variants';
export {
  annotateVariants,
  capsCall,
  dcapsOpportunities,
  differentialSites,
  digestFragments,
  enzymeCounts,
  findSites,
  isResolvable,
  iupacMatcher,
  variantContext,
  verifyWindow,
} from './caps';
export type {
  AnnotateOptions,
  CapsAnnotation,
  CapsCall,
  CapsCallOptions,
  CapsEnzymeHit,
  CapsSite,
  CapsUnknownReason,
  CapsVerdict,
  DcapsOpportunity,
  DcapsSide,
  VariantContext,
  WindowCheck,
} from './caps';
export { ampliconSeq, digestAmplicon, genomicToTemplatePosition, nonCutters, singleCutters, variantOnTemplate } from './amplicon';
export type { AmpliconDigest, DigestOptions, TemplateSpan, TemplateVariant } from './amplicon';
export { allocateEnzymeColours, COMMON_ENZYMES, ENZYME_PALETTE, enzymeColor, enzymeSpecificity, findEnzyme, isSixCutter, SIX_CUTTER_SPECIFICITY, siteWithCut } from './enzymes';
export type { RestrictionEnzyme } from './enzymes';
export { DESIGN_MODES, designModeOf, isDesignMode } from './modes';
export {
  ALL_MODES,
  availableModes,
  designerIdentity,
  hashString,
  initialDesignerState,
  normalizeDesignerState,
  toPersistedState,
} from './state';
export type { DesignerContext } from './state';
export {
  revcomp,
  mismatchGlyphIndex,
  mismatchIndexes,
  leftFootprint,
  rightFootprint,
  productSize,
  spansJunction,
  templateToGenomic,
  geneRelativeToGenomic,
  canonicalTranscriptId,
  transcriptLayout,
  cdnaToGenomicBlocks,
  geneTemplateExtent,
  geneLength,
  formatGenomic,
  formatRegion,
} from './coords';
export type { TranscriptLayout, TranscriptSegment } from './coords';
export { VERSION } from './version';

// ---- types ------------------------------------------------------------------
export type {
  AmpliconGene,
  AmpliconMismatches,
  ApiErrorBody,
  CheckExpected,
  CheckJob,
  CheckJobError,
  CheckKind,
  CheckName,
  CheckPairInput,
  CheckParams,
  CheckPrimerInfo,
  CheckProgress,
  CheckRequest,
  CheckResults,
  CheckStage,
  CheckStatus,
  DesignExplain,
  DesignerMode,
  DesignMode,
  DesignParamKey,
  DesignParams,
  DesignRequest,
  DesignResponse,
  DesignSettings,
  ExplainCounts,
  GenomeAmplicon,
  GenomeEntry,
  GenomesResponse,
  GenomicBlock,
  GenesInRegion,
  GenotypeAllele,
  GenotypeCopy,
  GenotypeGenomeRow,
  GenotypePrediction,
  GenotypePredictionRow,
  GenotypePrimerCall,
  GenotypePrimerStatus,
  GenotypeResults,
  GenotypeSetResults,
  GenotypeSetSummary,
  GenotypeSummary,
  CheckGenotypingBlock,
  CheckGenotypingSet,
  GenotypingAssay,
  GenotypingAssaySettings,
  GenotypingAttempt,
  GenotypingCheckPlan,
  GenotypingIssue,
  GenotypingNeighbourhood,
  GenotypingOligo,
  GenotypingOrderRow,
  GenotypingOrientation,
  GenotypingOrientationReport,
  GenotypingProduct,
  GenotypingQuality,
  GenotypingSetCheck,
  GenotypingSettings,
  GenotypingTemplate,
  GenotypingVariantInput,
  KaspMix,
  GenotypingAssayType,
  GenotypingDesignRequest,
  GenotypingDesignResponse,
  GenotypingParams,
  GenotypingSet,
  GenotypingState,
  GenotypingTab,
  GrameneExon,
  GrameneGene,
  GrameneTranscript,
  Interval,
  Likelihood,
  MaskSource,
  NumericDesignParamKey,
  OffTarget,
  Orientation,
  PangenomeAmplicon,
  PangenomeCellStatus,
  PangenomeGenomeResult,
  PangenomePairResult,
  PangenomeResults,
  PangenomeStatus,
  PangenomeSummary,
  PollOptions,
  PresetName,
  PrimerDesignerCheckState,
  PrimerDesignerFeatures,
  PrimerDesignerProps,
  PrimerDesignerState,
  PrimerGenomic,
  PrimerJunction,
  PrimerOligo,
  PrimerPair,
  PrimerProduct,
  PrimersClient,
  PrimersClientOptions,
  PrimerSensitivity,
  PrimerTemplate,
  PrimerWarning,
  ProductGenomic,
  ProductSizeRange,
  RegionGene,
  RegionSpec,
  RepeatMaskMode,
  RepeatMasking,
  RequestOptions,
  ResultsTab,
  SpecificityPairResult,
  // Renamed: `SpecificityResults` is the component.
  SpecificityResults as GenomeSpecificityResults,
  SpecificityVerdict,
  Strand,
  SubmittedGenotypingSet,
  SubmittedPair,
  TemplateExon,
  TemplateFeatures,
  TranscriptAmpliconGroup,
  TranscriptIsoform,
  TranscriptomePairResult,
  TranscriptomeResults,
  ValidationErrorItem,
  VariantDiscriminatingBase,
  VariantEntry,
  VariantIssue,
  VariantKind,
  VariantMinimal,
  VariantNeighbour,
  VariantRecord,
  VariantSource,
  VariantVcf,
  VariantListQuery,
  VariantListResponse,
  VariantLookupResponse,
} from './types';
