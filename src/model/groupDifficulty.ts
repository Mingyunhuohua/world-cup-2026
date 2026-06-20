import type { Team, TeamSimulationSummary } from "../types.ts";

export type GroupDifficultyLevel = "death" | "hard" | "balanced" | "open";

export type GroupDifficultySummary = {
  group: string;
  score: number;
  level: GroupDifficultyLevel;
  label: string;
  averageElo: number;
  averageFifaRank: number;
  topThreeAverageElo: number;
  qualificationSpread: number;
  pressureIndex: number;
};

export function calculateGroupDifficulty(
  group: string,
  teams: Team[],
  simulations: TeamSimulationSummary[] = []
): GroupDifficultySummary {
  if (!teams.length) {
    return {
      group,
      score: 0,
      level: "open",
      label: "暂无样本",
      averageElo: 0,
      averageFifaRank: 0,
      topThreeAverageElo: 0,
      qualificationSpread: 0,
      pressureIndex: 0
    };
  }

  const averageElo = average(teams.map((team) => team.elo));
  const averageFifaRank = average(teams.map((team) => team.fifaRank));
  const topThreeAverageElo = average(
    [...teams]
      .sort((left, right) => right.elo - left.elo)
      .slice(0, Math.min(3, teams.length))
      .map((team) => team.elo)
  );
  const qualificationProbabilities = simulations
    .filter((summary) => teams.some((team) => team.id === summary.teamId))
    .map((summary) => summary.groupQualification || summary.round32);
  const qualificationSpread = qualificationProbabilities.length
    ? Math.max(...qualificationProbabilities) - Math.min(...qualificationProbabilities)
    : 0.5;
  const pressureIndex = clamp((0.74 - qualificationSpread) / 0.56, 0, 1);

  const score =
    clamp((averageElo - 1540) / 360, 0, 1) * 36 +
    clamp((topThreeAverageElo - 1620) / 320, 0, 1) * 28 +
    clamp((62 - averageFifaRank) / 52, 0, 1) * 20 +
    pressureIndex * 16;

  return {
    group,
    score: Math.round(score),
    level: getDifficultyLevel(score),
    label: getDifficultyLabel(score),
    averageElo: Math.round(averageElo),
    averageFifaRank: Math.round(averageFifaRank),
    topThreeAverageElo: Math.round(topThreeAverageElo),
    qualificationSpread,
    pressureIndex
  };
}

function getDifficultyLevel(score: number): GroupDifficultyLevel {
  if (score >= 72) {
    return "death";
  }

  if (score >= 58) {
    return "hard";
  }

  if (score >= 42) {
    return "balanced";
  }

  return "open";
}

function getDifficultyLabel(score: number): string {
  if (score >= 72) {
    return "死亡之组";
  }

  if (score >= 58) {
    return "高压小组";
  }

  if (score >= 42) {
    return "均衡小组";
  }

  return "开放小组";
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
