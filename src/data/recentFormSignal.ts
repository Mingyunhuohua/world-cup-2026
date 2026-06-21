import type { TournamentSnapshot } from "../types.ts";

export type RecentFormSignal = {
  matches: number;
  form: number;
};

// 用本届世界杯已完赛的真实赛果折算"近期状态"信号，零成本、零外部依赖。
// 公式与 scripts/adapters/recent-form.mjs 的 mock 折算口径保持一致，
// 只是数据源换成了赛事内已发生的真实比赛而不是外部近期战绩表。
export function deriveRecentFormSignals(
  snapshot: TournamentSnapshot
): Map<string, RecentFormSignal> {
  type Accumulator = { matches: number; points: number; goalsFor: number; goalsAgainst: number };
  const stats = new Map<string, Accumulator>();

  function add(teamId: string, points: number, goalsFor: number, goalsAgainst: number) {
    const current = stats.get(teamId) ?? { matches: 0, points: 0, goalsFor: 0, goalsAgainst: 0 };
    current.matches += 1;
    current.points += points;
    current.goalsFor += goalsFor;
    current.goalsAgainst += goalsAgainst;
    stats.set(teamId, current);
  }

  for (const fixture of snapshot.fixtures) {
    if (fixture.status !== "completed" || !fixture.result) {
      continue;
    }

    const { homeGoals, awayGoals } = fixture.result;
    const homePoints = homeGoals > awayGoals ? 3 : homeGoals === awayGoals ? 1 : 0;
    const awayPoints = awayGoals > homeGoals ? 3 : homeGoals === awayGoals ? 1 : 0;

    add(fixture.homeTeamId, homePoints, homeGoals, awayGoals);
    add(fixture.awayTeamId, awayPoints, awayGoals, homeGoals);
  }

  const signals = new Map<string, RecentFormSignal>();
  for (const [teamId, value] of stats) {
    const pointsPerMatch = value.points / value.matches;
    const goalDifferencePerMatch = (value.goalsFor - value.goalsAgainst) / value.matches;
    const resultSignal = ((pointsPerMatch - 1.5) / 1.5) * 0.16;
    const goalSignal = clamp(goalDifferencePerMatch * 0.04, -0.08, 0.08);
    const form = roundTo(clamp(resultSignal + goalSignal, -0.22, 0.22), 3);

    signals.set(teamId, { matches: value.matches, form });
  }

  return signals;
}

// 已完赛比赛的稳定签名：内容不变则返回同一个字符串，用于判断是否需要重新计算。
export function buildCompletedResultsSignature(snapshot: TournamentSnapshot): string {
  return snapshot.fixtures
    .filter((fixture) => fixture.status === "completed" && fixture.result)
    .map((fixture) => `${fixture.id}:${fixture.result!.homeGoals}-${fixture.result!.awayGoals}`)
    .sort()
    .join(",");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
