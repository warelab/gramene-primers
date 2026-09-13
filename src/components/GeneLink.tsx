export interface GeneLinkProps {
  geneId: string;
  systemName?: string | null;
  geneHref?: (geneId: string, systemName?: string) => string;
  onGeneClick?: (geneId: string, systemName?: string) => void;
}

/** A gene id as a link (`geneHref`), a button (`onGeneClick`) or plain text. */
export function GeneLink({ geneId, systemName, geneHref, onGeneClick }: GeneLinkProps): JSX.Element {
  const sys = systemName ?? undefined;
  if (geneHref) {
    return (
      <a
        className="gpr-link"
        href={geneHref(geneId, sys)}
        onClick={
          onGeneClick
            ? (e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onGeneClick(geneId, sys);
              }
            : undefined
        }
      >
        {geneId}
      </a>
    );
  }
  if (onGeneClick) {
    return (
      <button type="button" className="gpr-link-button" onClick={() => onGeneClick(geneId, sys)}>
        {geneId}
      </button>
    );
  }
  return <span className="gpr-gene-id">{geneId}</span>;
}
