import { defaultPresetFor } from '../presets';
import type {
  CheckParams,
  DesignMode,
  DesignParamKey,
  DesignParams,
  Interval,
  PresetName,
  PrimerDesignerState,
  RepeatMaskMode,
  ResultsTab,
  SubmittedPair,
} from '../types';

export type DesignerAction =
  | { type: 'replace'; state: PrimerDesignerState }
  | { type: 'setMode'; mode: DesignMode }
  | { type: 'setTranscript'; transcriptId: string | undefined }
  | { type: 'setFlanks'; flankUp?: number; flankDown?: number }
  | { type: 'setRegion'; region: PrimerDesignerState['region'] }
  | { type: 'setSequence'; sequence: string }
  | { type: 'setSystemName'; systemName: string | undefined }
  | { type: 'setJunctionSpanning'; value: boolean }
  | { type: 'setRepeats'; avoidRepeats?: boolean; repeatMaskMode?: RepeatMaskMode }
  | { type: 'setIntervals'; target?: Interval; included?: Interval; excluded?: Interval[] }
  | { type: 'setIncluded'; included: Interval | undefined }
  | { type: 'setPreset'; preset: PresetName }
  | { type: 'setParam'; key: DesignParamKey; value: DesignParams[DesignParamKey] | undefined }
  | { type: 'resetParams' }
  | { type: 'setChecked'; rank: number; checked: boolean }
  | { type: 'setCheckedRanks'; ranks: number[] }
  | { type: 'select'; rank: number | undefined }
  | { type: 'designDone'; templateOnly: boolean; noPairs: boolean; checkedRanks?: number[]; selectedRank?: number | undefined }
  | { type: 'setPangenome'; enabled: boolean }
  | { type: 'setGenomes'; genomes: string[] | undefined }
  | { type: 'setCheckParam'; key: keyof CheckParams; value: number | boolean | undefined }
  | { type: 'checkJob'; jobId: string; submitted?: SubmittedPair[] }
  | { type: 'clearCheckJob' }
  | { type: 'setTab'; tab: ResultsTab }
  | { type: 'setExplainOpen'; open: boolean };

/** Returns a copy without keys whose value is `undefined` (keeps emitted state JSON-clean). */
function compact<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

const view = (s: PrimerDesignerState) => s.view ?? { resultsTab: 'pairs' as ResultsTab };
const check = (s: PrimerDesignerState) => s.check ?? { checks: ['specificity' as const] };

/** Pure state transitions of the designer (spec §C.2 state, §C.4). */
export function designerReducer(s: PrimerDesignerState, a: DesignerAction): PrimerDesignerState {
  switch (a.type) {
    case 'replace':
      return a.state;
    case 'setMode': {
      if (s.mode === a.mode) return s;
      // Keep a preset the user picked on purpose; otherwise follow the mode's default.
      const preset = s.preset && s.preset !== defaultPresetFor(s.mode) ? s.preset : defaultPresetFor(a.mode);
      // Intervals are template coordinates, which differ between modes.
      return compact({ ...s, mode: a.mode, preset, target: undefined, included: undefined, excluded: undefined });
    }
    case 'setTranscript':
      return compact({ ...s, transcriptId: a.transcriptId });
    case 'setFlanks':
      return compact({ ...s, flankUp: a.flankUp ?? s.flankUp, flankDown: a.flankDown ?? s.flankDown });
    case 'setRegion':
      return compact({ ...s, region: a.region });
    case 'setSequence':
      return { ...s, sequence: a.sequence };
    case 'setSystemName':
      return compact({ ...s, systemName: a.systemName });
    case 'setJunctionSpanning':
      return { ...s, junctionSpanning: a.value };
    case 'setRepeats':
      return compact({ ...s, avoidRepeats: a.avoidRepeats ?? s.avoidRepeats, repeatMaskMode: a.repeatMaskMode ?? s.repeatMaskMode });
    case 'setIntervals': {
      const excluded = a.excluded && a.excluded.length ? a.excluded.map((iv) => [iv[0], iv[1]] as Interval) : undefined;
      return compact({ ...s, target: a.target, included: a.included, excluded });
    }
    case 'setIncluded':
      return compact({ ...s, included: a.included });
    case 'setPreset':
      if (s.preset === a.preset && !s.params) return s;
      return compact({ ...s, preset: a.preset, params: undefined });
    case 'setParam': {
      const params = { ...(s.params ?? {}) } as Record<string, unknown>;
      if (a.value === undefined) delete params[a.key];
      else params[a.key] = a.value;
      return compact({ ...s, params: Object.keys(params).length ? (params as Partial<DesignParams>) : undefined });
    }
    case 'resetParams':
      return compact({ ...s, params: undefined });
    case 'setChecked': {
      const set = new Set(s.checkedRanks ?? []);
      if (a.checked) set.add(a.rank);
      else set.delete(a.rank);
      return { ...s, checkedRanks: [...set].sort((x, y) => x - y) };
    }
    case 'setCheckedRanks':
      return { ...s, checkedRanks: [...new Set(a.ranks)].sort((x, y) => x - y) };
    case 'select':
      return compact({ ...s, selectedRank: a.rank });
    case 'designDone': {
      if (a.templateOnly) return s;
      const next: PrimerDesignerState = { ...s, designed: true };
      if (a.checkedRanks) next.checkedRanks = [...a.checkedRanks].sort((x, y) => x - y);
      if ('selectedRank' in a) next.selectedRank = a.selectedRank;
      if (a.noPairs) next.view = { ...view(s), explainOpen: true };
      return compact(next);
    }
    case 'setPangenome': {
      const c = check(s);
      const checks: PrimerDesignerState['check'] = { ...c, checks: a.enabled ? ['specificity', 'pangenome'] : ['specificity'] };
      return { ...s, check: checks };
    }
    case 'setGenomes':
      return { ...s, check: compact({ ...check(s), genomes: a.genomes ? [...a.genomes] : undefined }) };
    case 'setCheckParam': {
      const c = check(s);
      const params = { ...(c.params ?? {}) } as Record<string, unknown>;
      if (a.value === undefined) delete params[a.key];
      else params[a.key] = a.value;
      return { ...s, check: compact({ ...c, params: Object.keys(params).length ? (params as Partial<CheckParams>) : undefined }) };
    }
    case 'checkJob': {
      const c = check(s);
      return { ...s, check: compact({ ...c, jobId: a.jobId, submitted: a.submitted ?? c.submitted }) };
    }
    case 'clearCheckJob': {
      const c = check(s);
      return { ...s, check: compact({ ...c, jobId: undefined, submitted: undefined }) };
    }
    case 'setTab':
      if (view(s).resultsTab === a.tab) return s;
      return { ...s, view: { ...view(s), resultsTab: a.tab } };
    case 'setExplainOpen':
      if (!!view(s).explainOpen === a.open) return s;
      return { ...s, view: { ...view(s), explainOpen: a.open } };
    default:
      return s;
  }
}
