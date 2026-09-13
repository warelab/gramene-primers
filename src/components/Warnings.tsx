import type { PrimerWarning } from '../types';
import { cx } from './util';

/** Fallback text for warning codes the server sends without a message. */
export const WARNING_TEXT: Readonly<Record<string, string>> = Object.freeze({
  NO_PAIRS: 'Primer3 found no acceptable primer pairs.',
  IUPAC_CONVERTED: 'IUPAC ambiguity codes in the sequence were converted to N.',
  MULTIPLE_RECORDS: 'Several FASTA records were joined into one template; primer pairs may span the joins.',
  SINGLE_EXON_TRANSCRIPT: 'The transcript has a single exon, so primers were designed without the junction constraint.',
  JUNCTIONS_TRUNCATED: 'Only the first 200 junctions (or those inside the included region) were used.',
  BLAST_DEPTH_MASK: 'Repeats were estimated with a BLAST copy-number heuristic; multi-copy gene families are masked too.',
  MOSTLY_REPEAT: 'More than 80% of the template is masked as repeat.',
  REPEAT_MASK_FAILED: 'Repeat masking failed; primers were designed without a mask.',
  NO_REPEAT_MASK: 'No repeat mask is available for this genome.',
  ASSEMBLY_MISMATCH: 'The assembly files do not fully match the genome annotation.',
  AMBIGUOUS_ASSEMBLY: 'Several assemblies match this genome; the newest was used.',
  PRIMER3_WARNING: 'Primer3 reported a warning.',
  MAX_PRODUCT_SIZE_RAISED: 'The maximum product size was raised to cover the expected products.',
  EXPECTED_IGNORED: 'Expected product locations are ignored in transcript mode.',
  PANGENOME_TRANSCRIPT_MODELS_ONLY: 'Annotated transcripts only: the pan-genome check searched annotated transcript models.',
  ANNOTATION_UNAVAILABLE: 'Gene annotation was unavailable; amplicons are not labelled with genes.',
  NO_FASTA_FOR_REALIGN: 'Some hits could not be re-aligned; their mismatch counts are lower bounds.',
  TRANSCRIPT_GENE_UNMAPPED: 'Some transcripts could not be mapped to genes.',
});

export interface WarningsProps {
  warnings: ReadonlyArray<PrimerWarning | string> | null | undefined;
  title?: string;
  className?: string;
}

export function Warnings({ warnings, title, className }: WarningsProps): JSX.Element | null {
  const list = (warnings ?? [])
    .map((w) => (typeof w === 'string' ? { code: w } : w))
    .filter((w): w is PrimerWarning => !!w && typeof w.code === 'string' && w.code.length > 0);
  if (!list.length) return null;
  return (
    <div className={cx('gpr-warnings', className)}>
      {title ? <p className="gpr-warnings-title">{title}</p> : null}
      <ul className="gpr-warning-list">
        {list.map((w, i) => (
          <li key={`${w.code}-${i}`} className="gpr-warning" data-code={w.code}>
            <span className="gpr-warning-glyph" aria-hidden="true">
              ⚠
            </span>
            <span className="gpr-warning-text">{w.message || WARNING_TEXT[w.code] || w.code}</span>{' '}
            <code className="gpr-code gpr-warning-code">{w.code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
