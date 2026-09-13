import { useState } from 'react';
import { copyText, downloadText } from '../clipboard';
import { useAnnounce } from './hooks/announcer';

export interface ExportItem {
  id: string;
  label: string;
  filename: string;
  mime?: string;
  /** Built lazily on Download/Copy. */
  build: () => string;
}

export interface ExportMenuProps {
  items: ReadonlyArray<ExportItem>;
  idPrefix: string;
}

/** Download (Blob + `<a download>`) or copy each export (spec §C.3 ExportMenu). */
export function ExportMenu({ items, idPrefix }: ExportMenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const announce = useAnnounce();
  if (!items.length) return null;
  const report = (msg: string) => {
    setStatus(msg);
    announce(msg);
  };
  const bodyId = `${idPrefix}-export-body`;
  const headingId = `${idPrefix}-export-h`;
  return (
    <section className="gpr-export" aria-labelledby={headingId}>
      <h3 className="gpr-h3" id={headingId}>
        <button type="button" className="gpr-disclosure" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          Export
        </button>
      </h3>
      <div id={bodyId} className="gpr-export-body" hidden={!open}>
        <ul className="gpr-export-list">
          {items.map((item) => (
            <li key={item.id} className="gpr-export-item" data-export={item.id}>
              <span className="gpr-export-label">{item.label}</span>
              <span className="gpr-export-actions">
                <button
                  type="button"
                  className="gpr-btn gpr-btn-small"
                  aria-label={`Download ${item.label}`}
                  onClick={() => {
                    const ok = downloadText(item.filename, item.build(), item.mime);
                    report(ok ? `Downloaded ${item.filename}` : 'Downloads are not available here; use Copy');
                  }}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="gpr-btn gpr-btn-small"
                  aria-label={`Copy ${item.label}`}
                  onClick={async () => {
                    const ok = await copyText(item.build());
                    report(ok ? `Copied ${item.label}` : 'Copy failed');
                  }}
                >
                  Copy
                </button>
              </span>
            </li>
          ))}
        </ul>
        {status ? (
          <p className="gpr-hint gpr-export-status" aria-hidden="true">
            {status}
          </p>
        ) : null}
      </div>
    </section>
  );
}
