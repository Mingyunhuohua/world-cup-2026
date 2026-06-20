import type { Match, Team, TournamentSnapshot } from "../types.ts";

export type FixtureImportHelper = {
  id: string;
  group: string;
  matchday: number;
  homeAbbr: string;
  awayAbbr: string;
  homeName: string;
  awayName: string;
  status: "scheduled" | "completed";
  score: string;
};

export function buildResultImportTemplate(match: Match): string {
  return JSON.stringify(
    {
      results: [
        {
          matchId: match.id,
          homeGoals: match.result?.homeGoals ?? 0,
          awayGoals: match.result?.awayGoals ?? 0,
          discipline: match.discipline ?? {
            home: {
              yellowCards: 0,
              secondYellowReds: 0,
              directRedCards: 0,
              yellowThenDirectReds: 0
            },
            away: {
              yellowCards: 0,
              secondYellowReds: 0,
              directRedCards: 0,
              yellowThenDirectReds: 0
            }
          }
        }
      ]
    },
    null,
    2
  );
}

export function buildFixturePatchTemplate(match: Match): string {
  return JSON.stringify(
    {
      fixtures: [
        {
          id: match.id,
          date: match.date,
          venue: match.venue,
          status: match.status ?? "scheduled",
          homeGoals: match.result?.homeGoals ?? 0,
          awayGoals: match.result?.awayGoals ?? 0,
          discipline: match.discipline ?? {
            home: { yellowCards: 0 },
            away: { yellowCards: 0 }
          }
        }
      ]
    },
    null,
    2
  );
}

export function buildBulkResultsTemplate(snapshot: TournamentSnapshot, limit = 3): string {
  return JSON.stringify(
    {
      results: snapshot.fixtures
        .filter((match) => match.status !== "completed")
        .slice(0, limit)
        .map((match) => ({
          matchId: match.id,
          homeGoals: 0,
          awayGoals: 0,
          discipline: {
            home: { yellowCards: 0 },
            away: { yellowCards: 0 }
          }
        }))
    },
    null,
    2
  );
}

export function buildCombinedDataPackageTemplate(snapshot: TournamentSnapshot): string {
  const contenders = snapshot.teams
    .slice()
    .sort((left, right) => left.fifaRank - right.fifaRank)
    .slice(0, 3);

  return JSON.stringify(
    {
      label: "Daily model input",
      teamPatches: contenders.map((team, index) => ({
        abbr: team.abbr,
        fifaRank: team.fifaRank,
        form: roundTo(team.form + (index === 0 ? 0.02 : 0), 3),
        injuries: roundTo(Math.max(0, team.injuries - (index === 1 ? 0.01 : 0)), 3),
        attack: roundTo(team.attack + (index === 0 ? 0.02 : 0), 3),
        defense: roundTo(team.defense, 3)
      }))
    },
    null,
    2
  );
}

export function buildFixtureImportHelpers(
  snapshot: TournamentSnapshot,
  groupFilter = "ALL"
): FixtureImportHelper[] {
  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));

  return snapshot.fixtures
    .filter((match) => groupFilter === "ALL" || match.group === groupFilter)
    .map((match) => toFixtureImportHelper(match, teamsById));
}

export function getImportHelperGroups(snapshot: TournamentSnapshot): string[] {
  return Array.from(
    new Set(
      snapshot.fixtures
        .map((match) => match.group)
        .filter((group): group is string => typeof group === "string")
    )
  ).sort();
}

function toFixtureImportHelper(
  match: Match,
  teamsById: Map<string, Team>
): FixtureImportHelper {
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);

  return {
    id: match.id,
    group: match.group ?? "-",
    matchday: match.matchday ?? 0,
    homeAbbr: home?.abbr ?? match.homeTeamId,
    awayAbbr: away?.abbr ?? match.awayTeamId,
    homeName: home?.name ?? match.homeTeamId,
    awayName: away?.name ?? match.awayTeamId,
    status: match.status ?? "scheduled",
    score: match.result ? `${match.result.homeGoals}-${match.result.awayGoals}` : "-"
  };
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;

  return Math.round(value * scale) / scale;
}
