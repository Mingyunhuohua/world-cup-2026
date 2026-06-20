import type {
  BracketSlot,
  GroupStanding,
  Match,
  ModelConfig,
  PredictionResult,
  SimulationSummary,
  Team,
  TeamSimulationSummary
} from "../types.ts";
import { buildScoreMatrix } from "./poisson.ts";
import { predictMatch } from "./predict.ts";
import { chooseByProbability, createSeededRng, type RandomSource } from "./random.ts";
import { calculateFairPlayPoints, rankGroupStandings, sortStandings } from "./standings.ts";
import {
  buildRoundOf32Pairs,
  type QualifiedTeam,
  type RoundOf32QualifiedTeams
} from "./tournamentRules.ts";

type SimCounts = {
  groupQualification: number;
  round32: number;
  round16: number;
  quarterFinal: number;
  semiFinal: number;
  final: number;
  champion: number;
  expectedPoints: number;
};

export type SimulationProgressUpdate = {
  completedIterations: number;
  totalIterations: number;
  progress: number;
};

type SimulationRunOptions = {
  iterations?: number;
  seed?: number;
  progressStep?: number;
  onProgress?: (update: SimulationProgressUpdate) => void;
};

export type KnockoutDecision = {
  winnerTeamId: string;
  decidedBy: "regulation" | "extra-time" | "penalties";
  regulationScore: {
    homeGoals: number;
    awayGoals: number;
  };
  extraTimeScore?: {
    homeGoals: number;
    awayGoals: number;
  };
};

const blankCounts = (): SimCounts => ({
  groupQualification: 0,
  round32: 0,
  round16: 0,
  quarterFinal: 0,
  semiFinal: 0,
  final: 0,
  champion: 0,
  expectedPoints: 0
});

const maxGlobalPredictionCacheEntries = 900;
const globalPredictionCache = new Map<string, PredictionResult>();

function getPredictionCacheKey(
  homeTeamId: string,
  awayTeamId: string,
  config: ModelConfig,
  matchId?: string,
  homeTeam?: Team,
  awayTeam?: Team
) {
  const homeSignature = homeTeam ? getTeamPredictionSignature(homeTeam) : "";
  const awaySignature = awayTeam ? getTeamPredictionSignature(awayTeam) : "";
  const configSignature = getModelConfigSignature(config);

  return `${matchId ?? "neutral"}__${homeTeamId}__${awayTeamId}__${configSignature}__${homeSignature}__${awaySignature}`;
}

function getTeamPredictionSignature(team: Team) {
  return [
    team.elo,
    team.fifaRank,
    team.attack,
    team.defense,
    team.form,
    team.injuries,
    team.host ? 1 : 0
  ]
    .map((value) => (typeof value === "number" ? value.toFixed(4) : value))
    .join(":");
}

function getModelConfigSignature(config: ModelConfig) {
  return [
    config.baseGoals,
    config.maxGoals,
    config.eloWeight,
    config.rankWeight,
    config.formWeight,
    config.injuryWeight,
    config.suspensionRiskWeight,
    config.hostBoost,
    config.restDaysWeight,
    config.dixonColesRho,
    config.extraTimeGoalRate,
    config.penaltyStrengthWeight
  ]
    .map((value) => value.toFixed(4))
    .join(":");
}

function getPrediction(
  match: Match,
  teams: Team[],
  config: ModelConfig,
  cache: Map<string, PredictionResult>,
  fixtures: Match[] = []
) {
  const homeTeam = teams.find((team) => team.id === match.homeTeamId);
  const awayTeam = teams.find((team) => team.id === match.awayTeamId);
  const key = getPredictionCacheKey(
    match.homeTeamId,
    match.awayTeamId,
    config,
    match.id,
    homeTeam,
    awayTeam
  );
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const globalCached = getGlobalPredictionCacheEntry(key);
  if (globalCached) {
    cache.set(key, globalCached);
    return globalCached;
  }

  const prediction = predictMatch(match, teams, config, fixtures);

  cache.set(key, prediction);
  setGlobalPredictionCacheEntry(key, prediction);
  return prediction;
}

function getGlobalPredictionCacheEntry(key: string): PredictionResult | undefined {
  const cached = globalPredictionCache.get(key);
  if (!cached) {
    return undefined;
  }

  globalPredictionCache.delete(key);
  globalPredictionCache.set(key, cached);
  return cached;
}

function setGlobalPredictionCacheEntry(key: string, prediction: PredictionResult) {
  if (globalPredictionCache.has(key)) {
    globalPredictionCache.delete(key);
  }

  globalPredictionCache.set(key, prediction);

  while (globalPredictionCache.size > maxGlobalPredictionCacheEntries) {
    const oldestKey = globalPredictionCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }

    globalPredictionCache.delete(oldestKey);
  }
}

export function clearPredictionCache() {
  globalPredictionCache.clear();
}

export function getPredictionCacheSize() {
  return globalPredictionCache.size;
}

function samplePredictionScore(prediction: PredictionResult, rng: RandomSource) {
  return chooseByProbability(
    prediction.scoreMatrix,
    (score) => score.probability,
    rng
  );
}

function sampleExtraTimeScore(
  prediction: PredictionResult,
  config: ModelConfig,
  rng: RandomSource
) {
  const extraTimeMatrix = buildScoreMatrix(
    prediction.lambdaHome * config.extraTimeGoalRate,
    prediction.lambdaAway * config.extraTimeGoalRate,
    Math.min(4, config.maxGoals),
    config.dixonColesRho * 0.35
  );

  return chooseByProbability(extraTimeMatrix, (score) => score.probability, rng);
}

export function calculateSuspensionLoad(
  fairPlayPoints: number,
  suspensionRiskWeight: number
): number {
  if (fairPlayPoints >= -3 || suspensionRiskWeight <= 0) {
    return 0;
  }

  return Math.min(0.22, Math.abs(fairPlayPoints + 3) * suspensionRiskWeight);
}

export function applyKnockoutSuspensionRisk(
  teams: Team[],
  standingsByGroup: Map<string, GroupStanding[]>,
  config: ModelConfig
): Team[] {
  const standingsByTeam = new Map<string, GroupStanding>();

  standingsByGroup.forEach((standings) => {
    standings.forEach((standing) => standingsByTeam.set(standing.teamId, standing));
  });

  return teams.map((team) => {
    const standing = standingsByTeam.get(team.id);
    const suspensionLoad = calculateSuspensionLoad(
      standing?.fairPlayPoints ?? 0,
      config.suspensionRiskWeight
    );

    if (suspensionLoad === 0) {
      return team;
    }

    return {
      ...team,
      injuries: Math.min(0.45, team.injuries + suspensionLoad),
      form: Math.max(-0.35, team.form - suspensionLoad * 0.35)
    };
  });
}

function simulateGroupStage(
  fixtures: Match[],
  teams: Team[],
  config: ModelConfig,
  cache: Map<string, PredictionResult>,
  rng: RandomSource
) {
  const standingsByGroup = new Map<string, GroupStanding[]>();

  for (const team of teams) {
    const groupStandings = standingsByGroup.get(team.group) ?? [];
    groupStandings.push({
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
    });
    standingsByGroup.set(team.group, groupStandings);
  }

  const standingLookup = new Map<string, GroupStanding>();
  const simulatedMatchesByGroup = new Map<string, Match[]>();
  for (const standings of standingsByGroup.values()) {
    standings.forEach((standing) => standingLookup.set(standing.teamId, standing));
  }

  for (const fixture of fixtures.filter((match) => match.round === "GROUP")) {
    const home = standingLookup.get(fixture.homeTeamId);
    const away = standingLookup.get(fixture.awayTeamId);
    if (!home || !away) {
      continue;
    }

    const score =
      fixture.result ??
      samplePredictionScore(
        getPrediction(fixture, teams, config, cache, fixtures),
        rng
      );
    const groupMatches = simulatedMatchesByGroup.get(fixture.group ?? "") ?? [];
    groupMatches.push({
      ...fixture,
      result: score
    });
    simulatedMatchesByGroup.set(fixture.group ?? "", groupMatches);

    home.played += 1;
    away.played += 1;
    home.goalsFor += score.homeGoals;
    home.goalsAgainst += score.awayGoals;
    away.goalsFor += score.awayGoals;
    away.goalsAgainst += score.homeGoals;
    home.fairPlayPoints =
      (home.fairPlayPoints ?? 0) + calculateFairPlayPoints(fixture.discipline?.home);
    away.fairPlayPoints =
      (away.fairPlayPoints ?? 0) + calculateFairPlayPoints(fixture.discipline?.away);

    if (score.homeGoals > score.awayGoals) {
      home.points += 3;
      home.wins += 1;
      away.losses += 1;
    } else if (score.homeGoals === score.awayGoals) {
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

  for (const [group, standings] of standingsByGroup.entries()) {
    standingsByGroup.set(
      group,
      rankGroupStandings(standings, simulatedMatchesByGroup.get(group) ?? [])
    );
  }

  return standingsByGroup;
}

function selectRoundOf32(
  standingsByGroup: Map<string, GroupStanding[]>
): RoundOf32QualifiedTeams {
  const firsts: QualifiedTeam[] = [];
  const seconds: QualifiedTeam[] = [];
  const thirds: QualifiedTeam[] = [];

  for (const [group, standings] of [...standingsByGroup.entries()].sort()) {
    standings.forEach((standing, index) => {
      const qualified = {
        teamId: standing.teamId,
        group,
        rank: index + 1,
        standing
      };
      if (index === 0) firsts.push(qualified);
      if (index === 1) seconds.push(qualified);
      if (index === 2) thirds.push(qualified);
    });
  }

  const bestThirds = thirds
    .sort((a, b) => sortStandings(a.standing, b.standing))
    .slice(0, 8);

  return { firsts, seconds, bestThirds };
}

export function resolveKnockoutWinner(
  homeTeamId: string,
  awayTeamId: string,
  prediction: PredictionResult,
  teams: Team[],
  config: ModelConfig,
  rng: RandomSource
) : KnockoutDecision {
  const score = samplePredictionScore(prediction, rng);

  if (score.homeGoals > score.awayGoals) {
    return {
      winnerTeamId: homeTeamId,
      decidedBy: "regulation",
      regulationScore: score
    };
  }
  if (score.awayGoals > score.homeGoals) {
    return {
      winnerTeamId: awayTeamId,
      decidedBy: "regulation",
      regulationScore: score
    };
  }

  const extraTimeScore = sampleExtraTimeScore(prediction, config, rng);

  if (extraTimeScore.homeGoals > extraTimeScore.awayGoals) {
    return {
      winnerTeamId: homeTeamId,
      decidedBy: "extra-time",
      regulationScore: score,
      extraTimeScore
    };
  }
  if (extraTimeScore.awayGoals > extraTimeScore.homeGoals) {
    return {
      winnerTeamId: awayTeamId,
      decidedBy: "extra-time",
      regulationScore: score,
      extraTimeScore
    };
  }

  const home = teams.find((team) => team.id === homeTeamId)!;
  const away = teams.find((team) => team.id === awayTeamId)!;
  const strengthEdge =
    ((home.elo - away.elo) / 450) * config.penaltyStrengthWeight +
    (home.form - away.form) * 0.25 -
    (home.injuries - away.injuries) * 0.18;
  const homePenaltyWin = 1 / (1 + Math.exp(-strengthEdge));

  return {
    winnerTeamId: rng() <= homePenaltyWin ? homeTeamId : awayTeamId,
    decidedBy: "penalties",
    regulationScore: score,
    extraTimeScore
  };
}

function knockoutWinner(
  homeTeamId: string,
  awayTeamId: string,
  teams: Team[],
  config: ModelConfig,
  cache: Map<string, PredictionResult>,
  rng: RandomSource
) {
  const prediction = getPrediction(
    {
      id: `knockout-${homeTeamId}-${awayTeamId}`,
      round: "R32",
      date: "",
      venue: "模拟中立场",
      homeTeamId,
      awayTeamId,
      neutral: true,
      source: {
        name: "simulation",
        updatedAt: "2026-06-13T00:00:00+08:00",
        confidence: "estimated"
      }
    },
    teams,
    config,
    cache
  );

  return resolveKnockoutWinner(
    homeTeamId,
    awayTeamId,
    prediction,
    teams,
    config,
    rng
  ).winnerTeamId;
}

function simulateKnockoutRound(
  participants: string[],
  teams: Team[],
  config: ModelConfig,
  cache: Map<string, PredictionResult>,
  rng: RandomSource
) {
  const winners: string[] = [];

  for (let index = 0; index < participants.length; index += 2) {
    const home = participants[index];
    const away = participants[index + 1];
    if (!home || !away) {
      continue;
    }
    winners.push(knockoutWinner(home, away, teams, config, cache, rng));
  }

  return winners;
}

function increment(counts: Map<string, SimCounts>, teamIds: string[], key: keyof SimCounts) {
  teamIds.forEach((teamId) => {
    counts.get(teamId)![key] += 1;
  });
}

export function getWilsonInterval(successes: number, trials: number, z = 1.96) {
  if (trials <= 0) {
    return { low: 0, high: 0 };
  }

  const proportion = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = proportion + zSquared / (2 * trials);
  const margin =
    z *
    Math.sqrt(
      (proportion * (1 - proportion) + zSquared / (4 * trials)) / trials
    );

  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator)
  };
}

export function simulateTournament(
  fixtures: Match[],
  teams: Team[],
  config: ModelConfig,
  iterations = config.simulationIterations,
  seed = 20260613
): SimulationSummary {
  return simulateTournamentWithProgress(fixtures, teams, config, {
    iterations,
    seed
  });
}

export function simulateTournamentWithProgress(
  fixtures: Match[],
  teams: Team[],
  config: ModelConfig,
  options: SimulationRunOptions = {}
): SimulationSummary {
  const iterations = options.iterations ?? config.simulationIterations;
  const seed = options.seed ?? 20260613;
  const progressStep = Math.max(1, options.progressStep ?? Math.ceil(iterations / 40));
  const rng = createSeededRng(seed);
  const counts = new Map<string, SimCounts>();
  const predictionCache = new Map<string, PredictionResult>();

  teams.forEach((team) => counts.set(team.id, blankCounts()));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const standingsByGroup = simulateGroupStage(
      fixtures,
      teams,
      config,
      predictionCache,
      rng
    );
    const qualified = selectRoundOf32(standingsByGroup);
    const round32Pairs = buildRoundOf32Pairs(qualified);
    const round32Teams = round32Pairs.flatMap((pair) => [
      pair[0].teamId,
      pair[1].teamId
    ]);
    const knockoutTeams = applyKnockoutSuspensionRisk(teams, standingsByGroup, config);

    increment(counts, round32Teams, "groupQualification");
    increment(counts, round32Teams, "round32");

    for (const standings of standingsByGroup.values()) {
      standings.forEach((standing) => {
        counts.get(standing.teamId)!.expectedPoints += standing.points;
      });
    }

    const round16 = simulateKnockoutRound(
      round32Teams,
      knockoutTeams,
      config,
      predictionCache,
      rng
    );
    increment(counts, round16, "round16");

    const quarterFinal = simulateKnockoutRound(
      round16,
      knockoutTeams,
      config,
      predictionCache,
      rng
    );
    increment(counts, quarterFinal, "quarterFinal");

    const semiFinal = simulateKnockoutRound(
      quarterFinal,
      knockoutTeams,
      config,
      predictionCache,
      rng
    );
    increment(counts, semiFinal, "semiFinal");

    const final = simulateKnockoutRound(
      semiFinal,
      knockoutTeams,
      config,
      predictionCache,
      rng
    );
    increment(counts, final, "final");

    const champion = simulateKnockoutRound(
      final,
      knockoutTeams,
      config,
      predictionCache,
      rng
    );
    increment(counts, champion, "champion");

    const completedIterations = iteration + 1;
    if (
      options.onProgress &&
      (completedIterations === iterations || completedIterations % progressStep === 0)
    ) {
      options.onProgress({
        completedIterations,
        totalIterations: iterations,
        progress: completedIterations / iterations
      });
    }
  }

  const summaries: TeamSimulationSummary[] = teams
    .map((team) => {
      const teamCounts = counts.get(team.id)!;
      const championInterval = getWilsonInterval(teamCounts.champion, iterations);
      return {
        teamId: team.id,
        group: team.group,
        groupQualification: teamCounts.groupQualification / iterations,
        round32: teamCounts.round32 / iterations,
        round16: teamCounts.round16 / iterations,
        quarterFinal: teamCounts.quarterFinal / iterations,
        semiFinal: teamCounts.semiFinal / iterations,
        final: teamCounts.final / iterations,
        champion: teamCounts.champion / iterations,
        championCiLow: championInterval.low,
        championCiHigh: championInterval.high,
        expectedPoints: teamCounts.expectedPoints / iterations
      };
    })
    .sort((a, b) => b.champion - a.champion);

  const bracketPreview: BracketSlot[] = summaries.slice(0, 16).map((summary, index) => ({
    label: index < 8 ? "上半区" : "下半区",
    teamId: summary.teamId,
    probability: summary.champion,
    probabilityCiLow: summary.championCiLow,
    probabilityCiHigh: summary.championCiHigh
  }));

  return {
    iterations,
    seed,
    teams: summaries,
    bracketPreview,
    generatedAt: new Date().toISOString()
  };
}
