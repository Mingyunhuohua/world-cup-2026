import type { DisciplineRecord, GroupStanding, Match, PredictionResult, Team } from "../types.ts";

type StandingComparator = (left: GroupStanding, right: GroupStanding) => number;

export type GroupTieBreakerStep = {
  id: string;
  label: string;
  status: "implemented" | "placeholder";
  notes: string;
};

export const groupTieBreakerSteps: GroupTieBreakerStep[] = [
  {
    id: "points",
    label: "小组积分",
    status: "implemented",
    notes: "胜 3 分，平 1 分，负 0 分。"
  },
  {
    id: "head-to-head",
    label: "相互战绩",
    status: "implemented",
    notes: "当存在完整赛果时，按同分球队之间的积分、净胜球、进球数排序。"
  },
  {
    id: "overall-goal-difference",
    label: "总净胜球",
    status: "implemented",
    notes: "相互战绩无法拆分时使用小组总净胜球。"
  },
  {
    id: "overall-goals-for",
    label: "总进球数",
    status: "implemented",
    notes: "总净胜球仍相同时使用总进球数。"
  },
  {
    id: "fair-play",
    label: "公平竞赛分",
    status: "implemented",
    notes: "按黄牌、两黄变红、直接红牌、黄牌后直接红牌计算扣分；无纪律数据时按 0 处理。"
  },
  {
    id: "drawing-lots",
    label: "抽签",
    status: "placeholder",
    notes: "真实抽签不可模拟复现，MVP 使用 FIFA 排名/ELO 作为稳定兜底。"
  }
];

function createStanding(team: Team): GroupStanding {
  return {
    teamId: team.id,
    group: team.group,
    played: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    fairPlayPoints: 0,
    fifaRankTieBreak: team.fifaRank,
    ratingTieBreak: team.elo
  };
}

export function calculateFairPlayPoints(record: DisciplineRecord = {}): number {
  return (
    -1 * (record.yellowCards ?? 0) +
    -3 * (record.secondYellowReds ?? 0) +
    -4 * (record.directRedCards ?? 0) +
    -5 * (record.yellowThenDirectReds ?? 0)
  );
}

function applyDiscipline(standing: GroupStanding, record: DisciplineRecord | undefined) {
  standing.fairPlayPoints = (standing.fairPlayPoints ?? 0) + calculateFairPlayPoints(record);
}

function compareOverallTieBreakers(a: GroupStanding, b: GroupStanding): number {
  return (
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    (b.fairPlayPoints ?? 0) - (a.fairPlayPoints ?? 0) ||
    (a.fifaRankTieBreak ?? Number.POSITIVE_INFINITY) -
      (b.fifaRankTieBreak ?? Number.POSITIVE_INFINITY) ||
    b.ratingTieBreak - a.ratingTieBreak
  );
}

export function sortStandings(a: GroupStanding, b: GroupStanding): number {
  return (
    b.points - a.points ||
    compareOverallTieBreakers(a, b)
  );
}

function groupByComparator(
  standings: GroupStanding[],
  comparator: StandingComparator
): GroupStanding[][] {
  const groups: GroupStanding[][] = [];

  for (const standing of standings) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || comparator(lastGroup[0], standing) !== 0) {
      groups.push([standing]);
    } else {
      lastGroup.push(standing);
    }
  }

  return groups;
}

function calculateHeadToHeadStats(
  tiedStandings: GroupStanding[],
  matches: Match[]
): Map<string, GroupStanding> {
  const tiedTeamIds = new Set(tiedStandings.map((standing) => standing.teamId));
  const stats = new Map<string, GroupStanding>();

  for (const standing of tiedStandings) {
    stats.set(standing.teamId, {
      ...standing,
      played: 0,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0
    });
  }

  for (const match of matches) {
    if (
      !match.result ||
      !tiedTeamIds.has(match.homeTeamId) ||
      !tiedTeamIds.has(match.awayTeamId)
    ) {
      continue;
    }

    const home = stats.get(match.homeTeamId);
    const away = stats.get(match.awayTeamId);
    if (!home || !away) {
      continue;
    }

    const { homeGoals, awayGoals } = match.result;
    applyDiscipline(home, match.discipline?.home);
    applyDiscipline(away, match.discipline?.away);
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.points += 3;
      home.wins += 1;
      away.losses += 1;
    } else if (homeGoals === awayGoals) {
      home.points += 1;
      away.points += 1;
      home.draws += 1;
      away.draws += 1;
    } else {
      away.points += 3;
      away.wins += 1;
      home.losses += 1;
    }

    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  return stats;
}

function compareHeadToHead(
  left: GroupStanding,
  right: GroupStanding,
  headToHeadStats: Map<string, GroupStanding>
): number {
  const leftStats = headToHeadStats.get(left.teamId);
  const rightStats = headToHeadStats.get(right.teamId);

  if (!leftStats || !rightStats || leftStats.played === 0 || rightStats.played === 0) {
    return 0;
  }

  return (
    rightStats.points - leftStats.points ||
    rightStats.goalDifference - leftStats.goalDifference ||
    rightStats.goalsFor - leftStats.goalsFor
  );
}

function resolveTiedStandings(
  tiedStandings: GroupStanding[],
  matches: Match[]
): GroupStanding[] {
  if (tiedStandings.length <= 1) {
    return tiedStandings;
  }

  const headToHeadStats = calculateHeadToHeadStats(tiedStandings, matches);
  const sortedByHeadToHead = [...tiedStandings].sort((left, right) =>
    compareHeadToHead(left, right, headToHeadStats)
  );
  const headToHeadGroups = groupByComparator(sortedByHeadToHead, (left, right) =>
    compareHeadToHead(left, right, headToHeadStats)
  );

  if (headToHeadGroups.length > 1) {
    return headToHeadGroups.flatMap((group) =>
      group.length === tiedStandings.length
        ? [...group].sort(compareOverallTieBreakers)
        : resolveTiedStandings(group, matches)
    );
  }

  return [...tiedStandings].sort(compareOverallTieBreakers);
}

export function rankGroupStandings(
  standings: GroupStanding[],
  groupMatches: Match[] = []
): GroupStanding[] {
  const sortedByPoints = [...standings].sort((left, right) => right.points - left.points);
  const pointGroups = groupByComparator(
    sortedByPoints,
    (left, right) => right.points - left.points
  );

  return pointGroups.flatMap((group) =>
    group.length > 1 ? resolveTiedStandings(group, groupMatches) : group
  );
}

function rankAllGroups(standings: GroupStanding[], matches: Match[]): GroupStanding[] {
  const standingsByGroup = new Map<string, GroupStanding[]>();
  const matchesByGroup = new Map<string, Match[]>();

  for (const standing of standings) {
    const groupStandings = standingsByGroup.get(standing.group) ?? [];
    groupStandings.push(standing);
    standingsByGroup.set(standing.group, groupStandings);
  }

  for (const match of matches) {
    if (!match.group) {
      continue;
    }

    const groupMatches = matchesByGroup.get(match.group) ?? [];
    groupMatches.push(match);
    matchesByGroup.set(match.group, groupMatches);
  }

  return [...standingsByGroup.entries()]
    .sort(([leftGroup], [rightGroup]) => leftGroup.localeCompare(rightGroup))
    .flatMap(([group, groupStandings]) =>
      rankGroupStandings(groupStandings, matchesByGroup.get(group) ?? [])
    );
}

export function calculateGroupStandings(
  matches: Match[],
  predictions: PredictionResult[],
  teams: Team[]
): GroupStanding[] {
  const standings = new Map<string, GroupStanding>();
  const predictionByMatch = new Map(
    predictions.map((prediction) => [prediction.matchId, prediction])
  );

  teams.forEach((team) => standings.set(team.id, createStanding(team)));

  for (const match of matches.filter((item) => item.round === "GROUP")) {
    const home = standings.get(match.homeTeamId);
    const away = standings.get(match.awayTeamId);
    const prediction = predictionByMatch.get(match.id);
    if (!home || !away) {
      continue;
    }

    home.played += 1;
    away.played += 1;

    if (match.result) {
      const { homeGoals, awayGoals } = match.result;
      applyDiscipline(home, match.discipline?.home);
      applyDiscipline(away, match.discipline?.away);
      home.goalsFor += homeGoals;
      home.goalsAgainst += awayGoals;
      away.goalsFor += awayGoals;
      away.goalsAgainst += homeGoals;

      if (homeGoals > awayGoals) {
        home.points += 3;
        home.wins += 1;
        away.losses += 1;
      } else if (homeGoals === awayGoals) {
        home.points += 1;
        away.points += 1;
        home.draws += 1;
        away.draws += 1;
      } else {
        away.points += 3;
        away.wins += 1;
        home.losses += 1;
      }

      home.goalDifference = home.goalsFor - home.goalsAgainst;
      away.goalDifference = away.goalsFor - away.goalsAgainst;
      continue;
    }

    if (!prediction) {
      continue;
    }

    applyDiscipline(home, match.discipline?.home);
    applyDiscipline(away, match.discipline?.away);
    home.points += prediction.homeWin * 3 + prediction.draw;
    away.points += prediction.awayWin * 3 + prediction.draw;
    home.goalsFor += prediction.lambdaHome;
    home.goalsAgainst += prediction.lambdaAway;
    away.goalsFor += prediction.lambdaAway;
    away.goalsAgainst += prediction.lambdaHome;
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  const roundedStandings = [...standings.values()]
    .map((standing) => ({
      ...standing,
      points: Number(standing.points.toFixed(2)),
      goalsFor: Number(standing.goalsFor.toFixed(2)),
      goalsAgainst: Number(standing.goalsAgainst.toFixed(2)),
      goalDifference: Number(standing.goalDifference.toFixed(2))
    }));

  return rankAllGroups(roundedStandings, matches);
}

export function calculateActualGroupStandings(
  groupMatches: Match[],
  teams: Team[]
): GroupStanding[] {
  const standings = new Map<string, GroupStanding>();
  teams.forEach((team) => standings.set(team.id, createStanding(team)));

  for (const match of groupMatches) {
    if (!match.result) {
      continue;
    }

    const home = standings.get(match.homeTeamId);
    const away = standings.get(match.awayTeamId);
    if (!home || !away) {
      continue;
    }

    const { homeGoals, awayGoals } = match.result;
    applyDiscipline(home, match.discipline?.home);
    applyDiscipline(away, match.discipline?.away);
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.points += 3;
      home.wins += 1;
      away.losses += 1;
    } else if (homeGoals === awayGoals) {
      home.points += 1;
      away.points += 1;
      home.draws += 1;
      away.draws += 1;
    } else {
      away.points += 3;
      away.wins += 1;
      home.losses += 1;
    }

    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  return rankGroupStandings([...standings.values()], groupMatches);
}
