import type {
  Match,
  ModelConfig,
  PredictionFactor,
  PredictionResult,
  ScoreProbability,
  Team
} from "../types.ts";
import { buildScoreMatrix } from "./poisson.ts";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function rankQuality(rank: number): number {
  return clamp((75 - rank) / 75, -0.25, 0.95);
}

function teamAdjustment(team: Team, opponent: Team, config: ModelConfig): number {
  const eloDelta = ((team.elo - opponent.elo) / 420) * config.eloWeight;
  const rankDelta =
    (rankQuality(team.fifaRank) - rankQuality(opponent.fifaRank)) *
    config.rankWeight;
  const formDelta = (team.form - opponent.form) * config.formWeight;
  const injuryDelta = (opponent.injuries - team.injuries) * config.injuryWeight;
  const hostDelta = team.host ? config.hostBoost : 0;

  return eloDelta + rankDelta + formDelta + injuryDelta + hostDelta;
}

export function calculateExpectedGoals(
  team: Team,
  opponent: Team,
  config: ModelConfig,
  restImpact = 0
): number {
  const adjustment = teamAdjustment(team, opponent, config) + restImpact;
  const attackDefenseRatio = team.attack / Math.max(0.72, opponent.defense);
  const lambda = config.baseGoals * attackDefenseRatio * Math.exp(adjustment * 0.28);

  return clamp(lambda, 0.18, 4.2);
}

export function calculateTeamRestDays(
  match: Match,
  teamId: string,
  fixtures: Match[]
): number | undefined {
  const matchTime = Date.parse(match.date);
  if (!Number.isFinite(matchTime)) {
    return undefined;
  }

  const previousMatch = fixtures
    .filter((fixture) => {
      const fixtureTime = Date.parse(fixture.date);
      return (
        fixture.id !== match.id &&
        Number.isFinite(fixtureTime) &&
        fixtureTime < matchTime &&
        (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
      );
    })
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0];

  if (!previousMatch) {
    return undefined;
  }

  return (matchTime - Date.parse(previousMatch.date)) / (24 * 60 * 60 * 1000);
}

function calculateRestContext(match: Match, config: ModelConfig, fixtures: Match[]) {
  const homeRestDays = calculateTeamRestDays(match, match.homeTeamId, fixtures);
  const awayRestDays = calculateTeamRestDays(match, match.awayTeamId, fixtures);

  if (homeRestDays === undefined || awayRestDays === undefined) {
    return {
      awayRestDays,
      homeRestDays,
      awayImpact: 0,
      homeImpact: 0,
      impact: 0
    };
  }

  const homeImpact = calculateRestTeamImpact(homeRestDays, awayRestDays, config);
  const awayImpact = calculateRestTeamImpact(awayRestDays, homeRestDays, config);

  return {
    awayRestDays,
    homeRestDays,
    awayImpact,
    homeImpact,
    impact: homeImpact - awayImpact
  };
}

function calculateRestTeamImpact(
  teamRestDays: number,
  opponentRestDays: number,
  config: ModelConfig
): number {
  const relativeEdge = clamp(teamRestDays - opponentRestDays, -4, 4);
  const ownRecovery = calculateRecoveryScore(teamRestDays);
  const opponentRecovery = calculateRecoveryScore(opponentRestDays);
  const rawImpact =
    relativeEdge * 0.55 +
    ownRecovery * 0.35 -
    opponentRecovery * 0.2;

  return clamp(rawImpact * config.restDaysWeight, -0.32, 0.28);
}

function calculateRecoveryScore(restDays: number): number {
  if (restDays < 4) {
    return clamp(restDays - 4, -3, 0);
  }

  if (restDays > 5) {
    return clamp((restDays - 5) * 0.5, 0, 1.5);
  }

  return 0;
}

function aggregateResultProbabilities(matrix: ScoreProbability[]) {
  return matrix.reduce(
    (result, score) => {
      if (score.homeGoals > score.awayGoals) {
        result.homeWin += score.probability;
      } else if (score.homeGoals === score.awayGoals) {
        result.draw += score.probability;
      } else {
        result.awayWin += score.probability;
      }
      return result;
    },
    { homeWin: 0, draw: 0, awayWin: 0 }
  );
}

function buildFactors(
  homeTeam: Team,
  awayTeam: Team,
  lambdaHome: number,
  lambdaAway: number,
  config: ModelConfig,
  restContext: ReturnType<typeof calculateRestContext>
): PredictionFactor[] {
  const eloImpact = ((homeTeam.elo - awayTeam.elo) / 400) * config.eloWeight;
  const formImpact = (homeTeam.form - awayTeam.form) * config.formWeight;
  const injuryImpact =
    (awayTeam.injuries - homeTeam.injuries) * config.injuryWeight;
  const hostImpact = homeTeam.host
    ? config.hostBoost
    : awayTeam.host
      ? -config.hostBoost
      : 0;
  const goalEdge = lambdaHome - lambdaAway;
  const restDescription =
    restContext.homeRestDays === undefined || restContext.awayRestDays === undefined
      ? "首战或缺少上一场日期，休息差未计入"
      : `${homeTeam.abbr} ${restContext.homeRestDays.toFixed(1)} 天 (${formatSigned(restContext.homeImpact)}) / ${awayTeam.abbr} ${restContext.awayRestDays.toFixed(1)} 天 (${formatSigned(restContext.awayImpact)})`;

  return [
    {
      label: "基础实力",
      impact: eloImpact,
      description: `ELO 差 ${Math.round(homeTeam.elo - awayTeam.elo)}，排名差 ${awayTeam.fifaRank - homeTeam.fifaRank}`
    },
    {
      label: "近期状态",
      impact: formImpact,
      description: `${homeTeam.abbr} 状态 ${homeTeam.form.toFixed(2)} / ${awayTeam.abbr} 状态 ${awayTeam.form.toFixed(2)}`
    },
    {
      label: "伤停影响",
      impact: injuryImpact,
      description: `伤停负荷 ${homeTeam.injuries.toFixed(2)} vs ${awayTeam.injuries.toFixed(2)}`
    },
    {
      label: "场地因素",
      impact: hostImpact,
      description:
        homeTeam.host || awayTeam.host
          ? "东道主或近主场环境修正"
          : "中立场，未加入主场优势"
    },
    {
      label: "赛程休息",
      impact: restContext.impact,
      description: restDescription
    },
    {
      label: "预期进球",
      impact: goalEdge,
      description: `${homeTeam.abbr} ${lambdaHome.toFixed(2)} xG / ${awayTeam.abbr} ${lambdaAway.toFixed(2)} xG`
    }
  ];
}

export function predictMatch(
  match: Match,
  teams: Team[],
  config: ModelConfig,
  fixtures: Match[] = []
): PredictionResult {
  const homeTeam = teams.find((team) => team.id === match.homeTeamId);
  const awayTeam = teams.find((team) => team.id === match.awayTeamId);

  if (!homeTeam || !awayTeam) {
    throw new Error(`Missing team for match ${match.id}`);
  }

  const restContext = calculateRestContext(match, config, fixtures);
  const lambdaHome = calculateExpectedGoals(homeTeam, awayTeam, config, restContext.homeImpact);
  const lambdaAway = calculateExpectedGoals(awayTeam, homeTeam, config, restContext.awayImpact);
  const scoreMatrix = buildScoreMatrix(
    lambdaHome,
    lambdaAway,
    config.maxGoals,
    config.dixonColesRho
  );
  const resultProbabilities = aggregateResultProbabilities(scoreMatrix);
  const topScores = [...scoreMatrix]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 8);

  const confidence = clamp(
    0.58 +
      Math.abs(resultProbabilities.homeWin - resultProbabilities.awayWin) * 0.32 -
      (homeTeam.injuries + awayTeam.injuries) * 0.08,
    0.42,
    0.86
  );

  return {
    matchId: match.id,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    lambdaHome,
    lambdaAway,
    ...resultProbabilities,
    scoreMatrix,
    topScores,
    factors: buildFactors(homeTeam, awayTeam, lambdaHome, lambdaAway, config, restContext),
    confidence
  };
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
