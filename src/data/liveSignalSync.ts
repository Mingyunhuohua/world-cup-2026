import type { DataImportSummary, TournamentSnapshot } from "../types.ts";
import { previewTournamentImport } from "./importPreview.ts";
import { buildCompletedResultsSignature, deriveRecentFormSignals } from "./recentFormSignal.ts";

const LAST_APPLIED_KEY = "wc2026-live-signal-last-applied-key";
const ODDS_FEED_URL = "./data/odds-live.json";

export type LiveSignalSyncResult = {
  snapshot: TournamentSnapshot;
  summary: DataImportSummary;
  appliedKey: string;
};

type OddsFeedTeamPatch = { abbr?: string; form?: number };
type OddsFeedPayload = { generatedAt?: string; teamPatches?: OddsFeedTeamPatch[] };

// 把"实时市场赔率"和"赛事内真实战绩"两路信号融合成一份球队 form 补丁后再应用，
// 避免两路信号各自写同一个字段时互相覆盖。赛果样本越多，近期战绩权重越高，
// 最高只占一半权重，避免早期 1-2 场的小样本波动盖过市场判断。
export async function checkLiveSignalUpdate(
  currentSnapshot: TournamentSnapshot
): Promise<LiveSignalSyncResult | undefined> {
  const oddsFeed = await fetchOddsFeed();
  const recentFormSignals = deriveRecentFormSignals(currentSnapshot);
  const resultsSignature = buildCompletedResultsSignature(currentSnapshot);
  const appliedKey = `${oddsFeed?.generatedAt ?? "no-odds"}|${resultsSignature}`;

  if (readLastAppliedKey() === appliedKey) {
    return undefined;
  }

  if (!oddsFeed && recentFormSignals.size === 0) {
    return undefined;
  }

  const oddsFormByAbbr = new Map<string, number>();
  for (const patch of oddsFeed?.teamPatches ?? []) {
    if (patch.abbr && typeof patch.form === "number") {
      oddsFormByAbbr.set(patch.abbr.toUpperCase(), patch.form);
    }
  }

  const teamPatches = currentSnapshot.teams
    .map((team) => {
      const oddsForm = oddsFormByAbbr.get(team.abbr.toUpperCase());
      const recent = recentFormSignals.get(team.id);

      if (oddsForm === undefined && recent === undefined) {
        return undefined;
      }
      if (oddsForm === undefined) {
        return { id: team.id, form: recent!.form };
      }
      if (recent === undefined) {
        return { id: team.id, form: oddsForm };
      }

      const recentWeight = clamp(recent.matches / 6, 0, 0.5);
      const blendedForm = roundTo(oddsForm * (1 - recentWeight) + recent.form * recentWeight, 3);
      return { id: team.id, form: blendedForm };
    })
    .filter((patch): patch is { id: string; form: number } => Boolean(patch));

  if (teamPatches.length === 0) {
    return undefined;
  }

  const importText = JSON.stringify({
    label: "实时赔率 + 赛事内近期战绩（自动融合）",
    generatedAt: new Date().toISOString(),
    teamPatches
  });

  let preview: ReturnType<typeof previewTournamentImport>;
  try {
    preview = previewTournamentImport(importText, currentSnapshot);
  } catch {
    return undefined;
  }

  if (preview.summary.importedTeams === 0) {
    return undefined;
  }

  return { snapshot: preview.snapshot, summary: preview.summary, appliedKey };
}

async function fetchOddsFeed(): Promise<OddsFeedPayload | undefined> {
  let response: Response;
  try {
    response = await fetch(ODDS_FEED_URL, { cache: "no-store" });
  } catch {
    return undefined;
  }

  if (!response.ok) {
    return undefined;
  }

  try {
    const payload: OddsFeedPayload = await response.json();
    if (!payload.generatedAt || !Array.isArray(payload.teamPatches)) {
      return undefined;
    }
    return payload;
  } catch {
    return undefined;
  }
}

export function markLiveSignalApplied(appliedKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LAST_APPLIED_KEY, appliedKey);
  } catch {
    // 隐私模式等场景下 localStorage 不可用时静默忽略。
  }
}

function readLastAppliedKey(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage.getItem(LAST_APPLIED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
