// Public React components (spec §C.2).
export { PrimerDesigner, designRequestFor } from './PrimerDesigner';
export { PairsTable, type PairsTableProps } from './PairsTable';
export { TemplateMap, packPairLanes, niceTicks, type TemplateMapProps } from './TemplateMap';
export { SpecificityResults, type SpecificityResultsProps } from './SpecificityResults';
export { PangenomeMatrix, PangenomeLegend, buildMatrixRows, type PangenomeMatrixProps, type MatrixRow, type MatrixCell } from './PangenomeMatrix';
export { GenomePicker, genomeAvailability, type GenomePickerProps } from './GenomePicker';
export { MASK_SOURCE_LABELS, expectedMaskSource } from './RepeatOptions';
export { VERDICT_META, type VerdictChipValue } from './VerdictChip';
export { WARNING_TEXT } from './Warnings';
export { designerReducer, type DesignerAction } from './reducer';
export type { StyleProps, Theme } from './Root';
