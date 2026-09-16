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
  // ---- genotyping: variant lookups ----------------------------------------
  DUPLICATE_VARIANT_IDS: 'Several Ensembl ids describe this variant; they were merged into one entry.',
  VARIATION_RECORDS_SKIPPED: 'Some variant records could not be read and were left out.',
  REF_MISMATCHES: 'Some variant records disagree with our reference sequence and were left out.',
  VARIANTS_TRUNCATED: 'Not all variants in this window are listed; narrow the window to see the rest.',
  NO_VARIATION_DATA: 'Known variants were not screened: this genome has no variant data, or lookups are switched off on this server.',
  NEIGHBOURS_UNAVAILABLE: 'Known variants could not be screened during this design, so neighbouring variants were not checked.',
  // ---- genotyping: design --------------------------------------------------
  EMS_TARGET: 'This is an EMS mutation, private to one mutant line; natural variants nearby warn instead of blocking.',
  MULTIALLELIC_SITE: 'Other alleles exist at this position; genomes carrying them mismatch both allele-specific primers.',
  SHIFTABLE_INDEL: 'This indel can slide along the sequence, so the wrong-allele primer may still amplify.',
  ORIENTATION_BLOCKED: 'A known variant sits in the last few bases of that orientation’s allele-specific primer.',
  DENSE_NEIGHBOURS: 'Several known variants lie close together here.',
  SUBMISSION_NEIGHBOURS_OMITTED: 'Some neighbouring variants were left as reference bases in the submission sequence.',
  VARIANT_IN_REPEAT: 'The repeat mask reached the allele-specific window.',
  ORIENTATION_SKIPPED: 'That orientation was skipped: too close to the end of the sequence, or an N in the allele-specific window.',
  ORIENTATION_NO_SETS: 'No primer set in that orientation cleared the minimum requirements.',
  RELAXED_CONSTRAINTS: 'These sets needed relaxed Primer3 constraints.',
  NO_SETS: 'No primer set was found in either orientation; the orientation cards explain why.',
  DESIGN_BUDGET_EXHAUSTED: 'The design stopped scoring further candidates; the sets shown are still valid.',
  // ---- genotyping: set issues ---------------------------------------------
  ALT_PRIMER_SUBOPTIMAL: 'A derived primer Primer3 would not have picked on its own, though it clears the hard limits.',
  AS_TM_IMBALANCE: 'The two allele-specific primers differ in melting temperature.',
  COMMON_TM_OUT_OF_RANGE: 'The common primer’s melting temperature sits outside the preferred window.',
  TAILED_STRUCTURE: 'The tailed oligo can fold or pair with itself near the annealing temperature.',
  MISMATCH_NOT_APPLICABLE: 'No deliberate mismatch was added: the base is the same in both allele-specific primers.',
  MISMATCH_STRUCTURE: 'The deliberate-mismatch primer can fold or pair with itself.',
  NEIGHBOUR_IN_PRIMER: 'Known variants lie inside a primer, away from its 3′ end.',
  NEIGHBOUR_AT_3P: 'A known variant lies in the last few bases of a primer, where it affects discrimination.',
  WEAK_DISCRIMINATION: 'This primer is predicted to amplify the other allele as well.',
  SHIFT_TRACT_DISCRIMINATION: 'The discriminating base lies inside the indel’s shift tract.',
  WEAK_TERMINAL_CLASS: 'Both 3′ mismatches are of a weakly discriminating type.',
  // ---- genotyping: check results ------------------------------------------
  REFERENCE_CONTROL_FAILED: 'The reference control did not give the expected allele, so that set’s other predictions are unreliable.',
  WEAK_OFF_TARGETS: 'Some off-target products were found with several mismatches; they are listed but do not change the allele predictions.',
  GENOTYPE_FALLBACK_FAILED: 'The fallback search failed for some genomes, which are reported as missing.',
  GENOTYPE_FALLBACK_BUDGET: 'The fallback search ran out of budget for some genomes, which are reported as missing.',
  GENOTYPE_FAILED: 'Allele calling failed for some genomes, which are reported as unavailable.',
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
