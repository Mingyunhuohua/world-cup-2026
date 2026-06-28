import type { DataImportSummary, Match, TournamentSnapshot } from "../types.ts";
import { buildKnockoutFixtures } from "../model/knockoutFixtures.ts";
import { previewTournamentImport } from "./importPreview.ts";
import { deriveRecentFormSignals } from "./recentFormSignal.ts";

const LAST_APPLIED_KEY = "wc2026-live-signal-last-applied-key";
const ODDS_FEED_URL = "./data/odds-live.json";
const RESULTS_FEED_URL = "./data/results-live.json";

export type LiveSignalSyncResult = {
  snapshot: TournamentSnapshot;
  summary: DataImportSummary;
  appliedKey: string;
};

type OddsFeedTeamPatch = { abbr?: string; form?: number };
type OddsFeedPayload = { generatedAt?: string; teamPatches?: OddsFeedTeamPatch[] };

type CompletedResult = {
  homeAbbr?: string;
  awayAbbr?: string;
  homeGoals?: number;
  awayGoals?: number;
};
type ResultsFeedPayload = { generatedAt?: string; completedResults?: CompletedResult[] };

type ResultPatch = { matchId: string; homeGoals: number; awayGoals: number };

// 把三路自动数据融合后一次性应用：真实赛果（比分）、实时市场赔率、赛事内近期战绩。
// 关键顺序：先用赛果得到"含最新比分的临时赛程"，再据此推导近期战绩，最后与赔率融合，
// 这样刚结束的比赛能立即进入状态推导。去重键只基于数据源时间戳（而非快照内容），
// 避免"应用赛果→快照变化→再次触发"的无限循环。
export async function checkLiveSignalUpdate(
  currentSnapshot: TournamentSnapshot
): Promise<LiveSignalSyncResult | undefined> {
  const [oddsFeed, resultsFeed] = await Promise.all([fetchOddsFeed(), fetchResultsFeed()]);
  const appliedKey = `${oddsFeed?.generatedAt ?? "no-odds"}|${resultsFeed?.generatedAt ?? "no-results"}`;

  if (readLastAppliedKey() === appliedKey) {
    return undefined;
  }

  const resultPatches = buildResultPatches(currentSnapshot, resultsFeed?.completedResults);
  const provisionalFixtures = applyResultPatches(currentSnapshot.fixtures, resultPatches);
  const recentFormSignals = deriveRecentFormSignals({
    ...currentSnapshot,
    fixtures: provisionalFixtures
  });

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

  if (teamPatches.length === 0 && resultPatches.length === 0) {
    return undefined;
  }

  const importText = JSON.stringify({
    label: "实时赛果 + 赔率 + 赛事内近期战绩（自动融合）",
    generatedAt: new Date().toISOString(),
    results: resultPatches,
    teamPatches
  });

  let preview: ReturnType<typeof previewTournamentImport>;
  try {
    preview = previewTournamentImport(importText, currentSnapshot);
  } catch {
    return undefined;
  }

  if (preview.summary.importedTeams === 0 && preview.summary.importedResults === 0) {
    return undefined;
  }

  // 赛果更新后用最新比分重新推导淘汰赛对阵：上一轮新完赛会催生下一轮对阵，
  // 旧的非 GROUP fixtures 全部丢弃后由 buildKnockoutFixtures 重算，保证幂等。
  const groupFixtures = preview.snapshot.fixtures.filter((match) => match.round === "GROUP");
  const regeneratedKnockout = buildKnockoutFixtures(groupFixtures, preview.snapshot.teams);
  const regeneratedSnapshot: TournamentSnapshot = {
    ...preview.snapshot,
    fixtures: [...groupFixtures, ...regeneratedKnockout],
    completedMatches: [...groupFixtures, ...regeneratedKnockout].filter(
      (match) => match.status === "completed"
    ).length,
    scheduledMatches: 0
  };
  regeneratedSnapshot.scheduledMatches = regeneratedSnapshot.fixtures.length - regeneratedSnapshot.completedMatches;

  return { snapshot: regeneratedSnapshot, summary: preview.summary, appliedKey };
}

// 按球队缩写对（不分主客顺序）把外部真实赛果匹配到内部赛程 ID，
// 只保留"新比分"：当前未完赛、或比分与已记录的不同。
export function buildResultPatches(
  snapshot: TournamentSnapshot,
  completedResults: CompletedResult[] | undefined
): ResultPatch[] {
  if (!completedResults || completedResults.length === 0) {
    return [];
  }

  const abbrById = new Map(snapshot.teams.map((team) => [team.id, team.abbr.toUpperCase()]));
  const patches: ResultPatch[] = [];

  for (const result of completedResults) {
    const homeAbbr = result.homeAbbr?.toUpperCase();
    const awayAbbr = result.awayAbbr?.toUpperCase();
    if (
      !homeAbbr ||
      !awayAbbr ||
      typeof result.homeGoals !== "number" ||
      typeof result.awayGoals !== "number"
    ) {
      continue;
    }

    const fixture = snapshot.fixtures.find((item) => {
      const a = abbrById.get(item.homeTeamId);
      const b = abbrById.get(item.awayTeamId);
      return (a === homeAbbr && b === awayAbbr) || (a === awayAbbr && b === homeAbbr);
    });
    if (!fixture) {
      continue;
    }

    // 按本地赛程的主客方向归位比分（外部来源主客顺序可能相反）。
    const fixtureHomeAbbr = abbrById.get(fixture.homeTeamId);
    const homeGoals = fixtureHomeAbbr === homeAbbr ? result.homeGoals : result.awayGoals;
    const awayGoals = fixtureHomeAbbr === homeAbbr ? result.awayGoals : result.homeGoals;

    const alreadySame =
      fixture.status === "completed" &&
      fixture.result?.homeGoals === homeGoals &&
      fixture.result?.awayGoals === awayGoals;
    if (alreadySame) {
      continue;
    }

    patches.push({ matchId: fixture.id, homeGoals, awayGoals });
  }

  return patches;
}

function applyResultPatches(fixtures: Match[], patches: ResultPatch[]): Match[] {
  if (patches.length === 0) {
    return fixtures;
  }
  const byId = new Map(patches.map((patch) => [patch.matchId, patch]));
  return fixtures.map((fixture) => {
    const patch = byId.get(fixture.id);
    if (!patch) {
      return fixture;
    }
    return {
      ...fixture,
      status: "completed",
      result: { homeGoals: patch.homeGoals, awayGoals: patch.awayGoals }
    };
  });
}

async function fetchOddsFeed(): Promise<OddsFeedPayload | undefined> {
  const payload = await fetchJson<OddsFeedPayload>(ODDS_FEED_URL);
  if (!payload?.generatedAt || !Array.isArray(payload.teamPatches)) {
    return undefined;
  }
  return payload;
}

async function fetchResultsFeed(): Promise<ResultsFeedPayload | undefined> {
  const payload = await fetchJson<ResultsFeedPayload>(RESULTS_FEED_URL);
  if (!payload?.generatedAt || !Array.isArray(payload.completedResults)) {
    return undefined;
  }
  return payload;
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as T;
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
