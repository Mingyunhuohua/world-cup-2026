import type { Match, ModelConfig, PredictionResult, Team, TournamentSnapshot } from "../types.ts";
import { predictMatch } from "../model/predict.ts";
import { simulateTournament } from "../model/simulate.ts";

export type TeamModelImpact = {
  teamId: string;
  label: string;
  beforeChampion: number;
  afterChampion: number;
  deltaChampion: number;
  beforeRound16: number;
  afterRound16: number;
  deltaRound16: number;
};

export type MatchModelImpact = {
  matchId: string;
  label: string;
  before: Pick<PredictionResult, "homeWin" | "draw" | "awayWin">;
  after: Pick<PredictionResult, "homeWin" | "draw" | "awayWin">;
  deltaHomeWin: number;
  deltaDraw: number;
  deltaAwayWin: number;
};

export type ImportModelImpact = {
  iterations: number;
  seed: number;
  teamImpacts: TeamModelImpact[];
  matchImpacts: MatchModelImpact[];
};

type ImportModelImpactOptions = {
  iterations?: number;
  seed?: number;
  selectedMatchId?: string;
};

const teamImpactFields: Array<keyof Team> = [
  "group",
  "fifaRank",
  "elo",
  "attack",
  "defense",
  "form",
  "injuries",
  "host"
];

const matchImpactFields: Array<keyof Match> = [
  "homeTeamId",
  "awayTeamId",
  "status",
  "result",
  "group",
  "matchday"
];

export function buildImportModelImpact(
  baseSnapshot: TournamentSnapshot,
  nextSnapshot: TournamentSnapshot,
  config: ModelConfig,
  options: ImportModelImpactOptions = {}
): ImportModelImpact {
  const iterations = options.iterations ?? Math.min(1000, Math.max(300, Math.round(config.simulationIterations / 10)));
  const seed = options.seed ?? 20260613;
  const baseSimulation = simulateTournament(baseSnapshot.fixtures, baseSnapshot.teams, config, iterations, seed);
  const nextSimulation = simulateTournament(nextSnapshot.fixtures, nextSnapshot.teams, config, iterations, seed);
  const changedTeamIds = detectChangedTeamIds(baseSnapshot, nextSnapshot);
  const changedMatchIds = detectChangedMatchIds(baseSnapshot, nextSnapshot);

  for (const matchId of changedMatchIds) {
    const match = nextSnapshot.fixtures.find((fixture) => fixture.id === matchId);

    if (match) {
      changedTeamIds.add(match.homeTeamId);
      changedTeamIds.add(match.awayTeamId);
    }
  }

  return {
    iterations,
    seed,
    teamImpacts: buildTeamImpacts(baseSnapshot, nextSnapshot, baseSimulation, nextSimulation, changedTeamIds),
    matchImpacts: buildMatchImpacts(baseSnapshot, nextSnapshot, config, {
      changedMatchIds,
      changedTeamIds,
      selectedMatchId: options.selectedMatchId
    })
  };
}

function buildTeamImpacts(
  baseSnapshot: TournamentSnapshot,
  nextSnapshot: TournamentSnapshot,
  baseSimulation: ReturnType<typeof simulateTournament>,
  nextSimulation: ReturnType<typeof simulateTournament>,
  changedTeamIds: Set<string>
): TeamModelImpact[] {
  const baseByTeam = new Map(baseSimulation.teams.map((team) => [team.teamId, team]));
  const nextByTeam = new Map(nextSimulation.teams.map((team) => [team.teamId, team]));
  const baseTeamsById = new Map(baseSnapshot.teams.map((team) => [team.id, team]));
  const impacts = nextSnapshot.teams.map((team) => {
    const before = baseByTeam.get(team.id);
    const after = nextByTeam.get(team.id);
    const beforeRound16 = before?.round16 ?? 0;
    const afterRound16 = after?.round16 ?? 0;
    const beforeChampion = before?.champion ?? 0;
    const afterChampion = after?.champion ?? 0;
    const labelTeam = baseTeamsById.get(team.id) ?? team;

    return {
      teamId: team.id,
      label: `${labelTeam.name} (${labelTeam.abbr})`,
      beforeChampion,
      afterChampion,
      deltaChampion: afterChampion - beforeChampion,
      beforeRound16,
      afterRound16,
      deltaRound16: afterRound16 - beforeRound16
    };
  });
  const prioritized = impacts
    .filter((impact) => changedTeamIds.has(impact.teamId))
    .sort(compareImpactMagnitude);
  const fallback = impacts
    .filter((impact) => !changedTeamIds.has(impact.teamId))
    .sort(compareImpactMagnitude);

  return [...prioritized, ...fallback].slice(0, 6);
}

function buildMatchImpacts(
  baseSnapshot: TournamentSnapshot,
  nextSnapshot: TournamentSnapshot,
  config: ModelConfig,
  options: {
    changedMatchIds: Set<string>;
    changedTeamIds: Set<string>;
    selectedMatchId?: string;
  }
): MatchModelImpact[] {
  const candidateIds = new Set<string>();

  if (options.selectedMatchId) {
    candidateIds.add(options.selectedMatchId);
  }

  for (const matchId of options.changedMatchIds) {
    candidateIds.add(matchId);
  }

  for (const fixture of nextSnapshot.fixtures) {
    if (
      candidateIds.size >= 8 ||
      (!options.changedTeamIds.has(fixture.homeTeamId) && !options.changedTeamIds.has(fixture.awayTeamId))
    ) {
      continue;
    }

    candidateIds.add(fixture.id);
  }

  return [...candidateIds]
    .flatMap((matchId) => buildMatchImpact(baseSnapshot, nextSnapshot, config, matchId))
    .sort(compareMatchImpactMagnitude)
    .slice(0, 5);
}

function buildMatchImpact(
  baseSnapshot: TournamentSnapshot,
  nextSnapshot: TournamentSnapshot,
  config: ModelConfig,
  matchId: string
): MatchModelImpact[] {
  const baseMatch = baseSnapshot.fixtures.find((match) => match.id === matchId);
  const nextMatch = nextSnapshot.fixtures.find((match) => match.id === matchId);

  if (!baseMatch || !nextMatch) {
    return [];
  }

  const before = predictMatch(baseMatch, baseSnapshot.teams, config, baseSnapshot.fixtures);
  const after = predictMatch(nextMatch, nextSnapshot.teams, config, nextSnapshot.fixtures);
  const teamsById = new Map(nextSnapshot.teams.map((team) => [team.id, team]));

  return [
    {
      matchId,
      label: `${teamsById.get(nextMatch.homeTeamId)?.abbr ?? nextMatch.homeTeamId} vs ${
        teamsById.get(nextMatch.awayTeamId)?.abbr ?? nextMatch.awayTeamId
      }`,
      before: pickResultProbabilities(before),
      after: pickResultProbabilities(after),
      deltaHomeWin: after.homeWin - before.homeWin,
      deltaDraw: after.draw - before.draw,
      deltaAwayWin: after.awayWin - before.awayWin
    }
  ];
}

function detectChangedTeamIds(baseSnapshot: TournamentSnapshot, nextSnapshot: TournamentSnapshot) {
  const baseTeamsById = new Map(baseSnapshot.teams.map((team) => [team.id, team]));
  const changed = new Set<string>();

  for (const team of nextSnapshot.teams) {
    const before = baseTeamsById.get(team.id);

    if (!before || teamImpactFields.some((field) => !sameValue(before[field], team[field]))) {
      changed.add(team.id);
    }
  }

  return changed;
}

function detectChangedMatchIds(baseSnapshot: TournamentSnapshot, nextSnapshot: TournamentSnapshot) {
  const baseMatchesById = new Map(baseSnapshot.fixtures.map((match) => [match.id, match]));
  const changed = new Set<string>();

  for (const match of nextSnapshot.fixtures) {
    const before = baseMatchesById.get(match.id);

    if (!before || matchImpactFields.some((field) => !sameValue(before[field], match[field]))) {
      changed.add(match.id);
    }
  }

  return changed;
}

function pickResultProbabilities(prediction: PredictionResult) {
  return {
    homeWin: prediction.homeWin,
    draw: prediction.draw,
    awayWin: prediction.awayWin
  };
}

function compareImpactMagnitude(left: TeamModelImpact, right: TeamModelImpact) {
  return (
    Math.abs(right.deltaChampion) - Math.abs(left.deltaChampion) ||
    Math.abs(right.deltaRound16) - Math.abs(left.deltaRound16)
  );
}

function compareMatchImpactMagnitude(left: MatchModelImpact, right: MatchModelImpact) {
  return maxMatchDelta(right) - maxMatchDelta(left);
}

function maxMatchDelta(impact: MatchModelImpact) {
  return Math.max(
    Math.abs(impact.deltaHomeWin),
    Math.abs(impact.deltaDraw),
    Math.abs(impact.deltaAwayWin)
  );
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
