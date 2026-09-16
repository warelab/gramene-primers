import { designModeOf } from '../modes';
import { defaultPresetFor } from '../presets';
import { GENOTYPING_CHECK_LIMITS } from '../request';
import type {
  CheckParams,
  DesignerMode,
  DesignParamKey,
  DesignParams,
  GenotypingAssay,
  GenotypingParams,
  GenotypingState,
  GenotypingTab,
  Interval,
  PresetName,
  PrimerDesignerState,
  RepeatMaskMode,
  ResultsTab,
  SubmittedGenotypingSet,
  SubmittedPair,
} from '../types';

export type DesignerAction =
  | { type: 'replace'; state: PrimerDesignerState }
  | { type: 'setMode'; mode: DesignerMode }
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
  | { type: 'setExplainOpen'; open: boolean }
  | { type: 'setFormWidth'; width: number | undefined }
  // ---- genotyping ----------------------------------------------------------
  | { type: 'setGenotypingVariant'; variantId?: string; alt?: string; variantKey?: string; manual?: GenotypingState['manual'] }
  | { type: 'setGenotypingWindow'; window: GenotypingState['window'] }
  | { type: 'setGenotypingFilters'; filters: GenotypingState['filters'] }
  | { type: 'setGenotypingAssay'; assay: Partial<GenotypingAssay> }
  | { type: 'setGenotypingParam'; key: keyof GenotypingParams; value: GenotypingParams[keyof GenotypingParams] | undefined }
  | { type: 'resetGenotypingParams' }
  | { type: 'setGenotypingLabel'; label: string | undefined }
  | { type: 'setGenotypingRepeats'; avoidRepeats?: boolean; repeatMaskMode?: RepeatMaskMode }
  | { type: 'genotypingDesignDone'; templateOnly: boolean; noSets: boolean; checkedSetKeys?: string[]; selectedSetKey?: string | undefined }
  | { type: 'selectGenotypingSet'; key: string | undefined }
  | { type: 'setGenotypingChecked'; key: string; checked: boolean }
  | { type: 'setGenotypingCheckedKeys'; keys: string[] }
  | { type: 'setGenotypingTab'; tab: GenotypingTab }
  | { type: 'setGenotypingPangenome'; enabled: boolean }
  | { type: 'setGenotypingGenomes'; genomes: string[] | undefined }
  | { type: 'setGenotypingCheckParam'; key: keyof CheckParams; value: number | boolean | undefined }
  | { type: 'genotypingCheckJob'; jobId: string; submitted?: SubmittedGenotypingSet[] }
  /** Remembers what was submitted before the job id comes back, so results still match after a re-design. */
  | { type: 'setGenotypingSubmitted'; submitted: SubmittedGenotypingSet[] }
  | { type: 'clearGenotypingCheckJob' };

/** Returns a copy without keys whose value is `undefined` (keeps emitted state JSON-clean). */
function compact<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

const view = (s: PrimerDesignerState) => s.view ?? { resultsTab: 'pairs' as ResultsTab };
const check = (s: PrimerDesignerState) => s.check ?? { checks: ['specificity' as const] };

const gt = (s: PrimerDesignerState): GenotypingState => s.genotyping ?? {};
const gtCheck = (s: PrimerDesignerState) => gt(s).check ?? { checks: ['specificity' as const] };

/** Writes the genotyping slice back, dropping it entirely once it holds nothing. */
function setGt(s: PrimerDesignerState, next: GenotypingState): PrimerDesignerState {
  const g = compact(next);
  return compact({ ...s, genotyping: Object.keys(g).length ? g : undefined });
}

/**
 * A new variant invalidates every design output: sets are designed for one
 * variant, and their keys and any check job belong to the old one.
 */
function clearGenotypingDesign(g: GenotypingState): GenotypingState {
  return { ...g, designed: undefined, selectedSetKey: undefined, checkedSetKeys: undefined, check: undefined };
}

/** Pure state transitions of the designer (spec §C.2 state, §C.4). */
export function designerReducer(s: PrimerDesignerState, a: DesignerAction): PrimerDesignerState {
  switch (a.type) {
    case 'replace':
      return a.state;
    case 'setMode': {
      if (s.mode === a.mode) return s;
      // Keep a preset the user picked on purpose; otherwise follow the mode's default.
      const preset = s.preset && s.preset !== defaultPresetFor(designModeOf(s.mode)) ? s.preset : defaultPresetFor(designModeOf(a.mode));
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
    case 'setFormWidth':
      if (view(s).formWidth === a.width) return s;
      return { ...s, view: compact({ ...view(s), formWidth: a.width }) };

    // ---- genotyping --------------------------------------------------------
    case 'setGenotypingVariant': {
      const g = clearGenotypingDesign(gt(s));
      return setGt(s, { ...g, variantId: a.variantId, alt: a.alt, variantKey: a.variantKey, manual: a.manual });
    }
    case 'setGenotypingWindow':
      return setGt(s, { ...gt(s), window: a.window });
    case 'setGenotypingFilters':
      return setGt(s, { ...gt(s), filters: a.filters });
    case 'setGenotypingAssay': {
      const g = gt(s);
      const assay = compact({ ...(g.assay ?? {}), ...a.assay });
      // Switching assay type re-derives every default, so keep only the type. An
      // absent type means kasp, and the first assay set is never a switch.
      const prevType = g.assay ? g.assay.type ?? 'kasp' : undefined;
      const next = a.assay.type && prevType && a.assay.type !== prevType ? { type: a.assay.type } : assay;
      return setGt(s, { ...g, assay: Object.keys(next).length ? next : undefined });
    }
    case 'setGenotypingParam': {
      const g = gt(s);
      const params = { ...(g.params ?? {}) } as Record<string, unknown>;
      if (a.value === undefined) delete params[a.key];
      else params[a.key] = a.value;
      return setGt(s, { ...g, params: Object.keys(params).length ? (params as Partial<GenotypingParams>) : undefined });
    }
    case 'resetGenotypingParams':
      return setGt(s, { ...gt(s), params: undefined });
    case 'setGenotypingLabel':
      return setGt(s, { ...gt(s), label: a.label });
    case 'setGenotypingRepeats': {
      const g = gt(s);
      return setGt(s, { ...g, avoidRepeats: a.avoidRepeats ?? g.avoidRepeats, repeatMaskMode: a.repeatMaskMode ?? g.repeatMaskMode });
    }
    case 'genotypingDesignDone': {
      if (a.templateOnly) return s;
      const g: GenotypingState = { ...gt(s), designed: true };
      if (a.checkedSetKeys) g.checkedSetKeys = a.checkedSetKeys.slice(0, GENOTYPING_CHECK_LIMITS.maxSets);
      if ('selectedSetKey' in a) g.selectedSetKey = a.selectedSetKey;
      // With no sets the orientation cards carry the explanation, so stay on Sets.
      if (a.noSets) g.view = { tab: 'sets' };
      return setGt(s, g);
    }
    case 'selectGenotypingSet':
      return setGt(s, { ...gt(s), selectedSetKey: a.key });
    case 'setGenotypingChecked': {
      const g = gt(s);
      const keys = g.checkedSetKeys ?? [];
      if (a.checked) {
        if (keys.includes(a.key) || keys.length >= GENOTYPING_CHECK_LIMITS.maxSets) return s;
        return setGt(s, { ...g, checkedSetKeys: [...keys, a.key] });
      }
      if (!keys.includes(a.key)) return s;
      const next = keys.filter((k) => k !== a.key);
      return setGt(s, { ...g, checkedSetKeys: next.length ? next : undefined });
    }
    case 'setGenotypingCheckedKeys': {
      const keys = [...new Set(a.keys)].slice(0, GENOTYPING_CHECK_LIMITS.maxSets);
      return setGt(s, { ...gt(s), checkedSetKeys: keys.length ? keys : undefined });
    }
    case 'setGenotypingTab': {
      const g = gt(s);
      if (g.view?.tab === a.tab) return s;
      return setGt(s, { ...g, view: { tab: a.tab } });
    }
    case 'setGenotypingPangenome': {
      const c = gtCheck(s);
      return setGt(s, { ...gt(s), check: { ...c, checks: a.enabled ? ['specificity', 'pangenome'] : ['specificity'] } });
    }
    case 'setGenotypingGenomes':
      return setGt(s, { ...gt(s), check: compact({ ...gtCheck(s), genomes: a.genomes ? [...a.genomes] : undefined }) });
    case 'setGenotypingCheckParam': {
      const c = gtCheck(s);
      const params = { ...(c.params ?? {}) } as Record<string, unknown>;
      if (a.value === undefined) delete params[a.key];
      else params[a.key] = a.value;
      return setGt(s, { ...gt(s), check: compact({ ...c, params: Object.keys(params).length ? (params as Partial<CheckParams>) : undefined }) });
    }
    case 'genotypingCheckJob': {
      const c = gtCheck(s);
      return setGt(s, { ...gt(s), check: compact({ ...c, jobId: a.jobId, submitted: a.submitted ?? c.submitted }) });
    }
    case 'setGenotypingSubmitted': {
      const c = gtCheck(s);
      return setGt(s, { ...gt(s), check: compact({ ...c, submitted: a.submitted.length ? a.submitted : undefined }) });
    }
    case 'clearGenotypingCheckJob': {
      const c = gtCheck(s);
      return setGt(s, { ...gt(s), check: compact({ ...c, jobId: undefined, submitted: undefined }) });
    }
    default:
      return s;
  }
}
