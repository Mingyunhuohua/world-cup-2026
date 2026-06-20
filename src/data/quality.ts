import type { DataQualityCheck, TournamentSnapshot } from "../types.ts";

const expectedTeamCount = 48;
const expectedGroupCount = 12;
const expectedTeamsPerGroup = 4;
const expectedGroupFixtureCount = 72;
const rankingFreshnessDays = 45;

export function validateTournamentSnapshot(snapshot: TournamentSnapshot): DataQualityCheck[] {
  const checks: DataQualityCheck[] = [];
  const teamsByGroup = countBy(snapshot.teams.map((team) => team.group));
  const fixtureIds = snapshot.fixtures.map((fixture) => fixture.id);
  const duplicateFixtureIds = findDuplicates(fixtureIds);
  const duplicateGroupPairs = findDuplicateGroupPairs(snapshot);
  const completedWithoutScore = snapshot.fixtures.filter(
    (fixture) => fixture.status === "completed" && !fixture.result
  );
  const scheduledWithScore = snapshot.fixtures.filter(
    (fixture) => fixture.status !== "completed" && fixture.result
  );
  const rankingSource = snapshot.sources.find((source) => source.id === "fifa-ranking");
  const activeOfficialSources = snapshot.sources.filter(
    (source) => source.kind === "official" && source.status === "active"
  );
  const staleRankingDays = rankingSource
    ? daysBetween(rankingSource.updatedAt, snapshot.collectedAt)
    : Number.POSITIVE_INFINITY;

  checks.push({
    id: "team-count",
    label: "参赛球队数量",
    level: snapshot.teams.length === expectedTeamCount ? "pass" : "fail",
    actual: snapshot.teams.length,
    expected: expectedTeamCount,
    detail:
      snapshot.teams.length === expectedTeamCount
        ? "48 支球队已进入当前快照。"
        : "球队数量不完整会影响小组模拟和淘汰赛晋级统计。"
  });

  checks.push({
    id: "group-shape",
    label: "分组结构",
    level: isCompleteGroupShape(teamsByGroup) ? "pass" : "fail",
    actual: `${teamsByGroup.size} 组`,
    expected: `${expectedGroupCount} 组，每组 ${expectedTeamsPerGroup} 队`,
    detail: isCompleteGroupShape(teamsByGroup)
      ? "12 个小组均为 4 队结构。"
      : "分组结构异常会导致小组排名和最佳第三名逻辑失真。"
  });

  checks.push({
    id: "group-fixture-count",
    label: "小组赛赛程",
    level: snapshot.fixtures.length === expectedGroupFixtureCount ? "pass" : "fail",
    actual: snapshot.fixtures.length,
    expected: expectedGroupFixtureCount,
    detail:
      snapshot.fixtures.length === expectedGroupFixtureCount
        ? "72 场小组赛已覆盖。"
        : "小组赛场次缺失或重复会直接影响蒙特卡洛路径。"
  });

  checks.push({
    id: "fixture-duplicates",
    label: "重复赛程检查",
    level: duplicateFixtureIds.length === 0 && duplicateGroupPairs.length === 0 ? "pass" : "fail",
    actual: duplicateFixtureIds.length + duplicateGroupPairs.length,
    expected: 0,
    detail:
      duplicateFixtureIds.length === 0 && duplicateGroupPairs.length === 0
        ? "未发现重复比赛 ID 或小组内重复对阵。"
        : "存在重复比赛，需要先清洗后再模拟。"
  });

  checks.push({
    id: "result-consistency",
    label: "赛果状态一致性",
    level: completedWithoutScore.length === 0 && scheduledWithScore.length === 0 ? "pass" : "fail",
    actual: completedWithoutScore.length + scheduledWithScore.length,
    expected: 0,
    detail:
      completedWithoutScore.length === 0 && scheduledWithScore.length === 0
        ? "完赛状态和比分字段一致。"
        : "完赛/未赛状态与比分字段不一致。"
  });

  checks.push({
    id: "official-sources",
    label: "官方来源覆盖",
    level: activeOfficialSources.length >= 2 ? "pass" : "warn",
    actual: activeOfficialSources.length,
    expected: "至少 2 个",
    detail:
      activeOfficialSources.length >= 2
        ? "赛程和排名均有官方来源记录。"
        : "官方来源不足，建议补齐赛程和排名的官方采集链路。"
  });

  checks.push({
    id: "ranking-freshness",
    label: "排名新鲜度",
    level: rankingSource && staleRankingDays <= rankingFreshnessDays ? "pass" : "warn",
    actual: rankingSource ? `${Math.round(staleRankingDays)} 天` : "缺失",
    expected: `${rankingFreshnessDays} 天内`,
    detail:
      rankingSource && staleRankingDays <= rankingFreshnessDays
        ? "FIFA 排名快照仍在可接受更新窗口内。"
        : "排名可能过期，后续应接入官方排名刷新。"
  });

  checks.push({
    id: "dynamic-feeds",
    label: "动态数据接入",
    level: "warn",
    actual: "占位",
    expected: "伤停、赔率、新闻、近期战绩自动更新",
    detail: "MVP 已预留动态数据接口，但尚未执行真实联网刷新。"
  });

  return checks;
}

export function countQualityLevels(checks: DataQualityCheck[]) {
  return checks.reduce(
    (accumulator, check) => ({
      ...accumulator,
      [check.level]: accumulator[check.level] + 1
    }),
    { fail: 0, pass: 0, warn: 0 }
  );
}

function isCompleteGroupShape(teamsByGroup: Map<string, number>): boolean {
  if (teamsByGroup.size !== expectedGroupCount) {
    return false;
  }

  return Array.from(teamsByGroup.values()).every((count) => count === expectedTeamsPerGroup);
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates);
}

function findDuplicateGroupPairs(snapshot: TournamentSnapshot): string[] {
  const pairs = snapshot.fixtures
    .filter((fixture) => fixture.round === "GROUP")
    .map((fixture) => {
      const teams = [fixture.homeTeamId, fixture.awayTeamId].sort();
      return `${fixture.group ?? "?"}:${teams[0]}-${teams[1]}`;
    });

  return findDuplicates(pairs);
}

function daysBetween(start: string, end: string): number {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (endTime - startTime) / 86_400_000);
}
