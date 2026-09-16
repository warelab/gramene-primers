import type { DesignerMode } from '../types';
import { TabList } from './fields';
import { MODE_LABELS } from './util';

export interface ModeTabsProps {
  modes: ReadonlyArray<DesignerMode>;
  value: DesignerMode;
  onChange: (mode: DesignerMode) => void;
  /** Reason text for modes that cannot be used (e.g. gene > 50 kb). */
  disabled?: Partial<Record<DesignerMode, string>>;
  idPrefix: string;
  panelId: string;
}

/** Header tabs, limited to the modes offered (spec §C.3). */
export function ModeTabs({ modes, value, onChange, disabled, idPrefix, panelId }: ModeTabsProps): JSX.Element {
  const hintId = (m: DesignerMode) => `${idPrefix}-mode-hint-${m}`;
  const items = modes.map((m) => ({
    id: m,
    label: MODE_LABELS[m],
    disabledReason: disabled?.[m] ?? null,
    describedBy: disabled?.[m] ? hintId(m) : undefined,
  }));
  return (
    <div className="gpr-mode-tabs">
      <TabList items={items} value={value} onChange={onChange} label="Design mode" idPrefix={`${idPrefix}-mode`} panelId={panelId} className="gpr-tabs-mode" />
      {modes
        .filter((m) => disabled?.[m])
        .map((m) => (
          <p key={m} id={hintId(m)} className="gpr-hint gpr-tab-hint">
            {MODE_LABELS[m]} mode is unavailable: {disabled?.[m]}
          </p>
        ))}
    </div>
  );
}
