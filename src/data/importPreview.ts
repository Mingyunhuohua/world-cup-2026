import type { DataImportSummary, Match, Team, TournamentSnapshot } from "../types.ts";
import { importTournamentJson } from "./import.ts";

export type ImportFieldChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type ImportEntityChange = {
  id: string;
  label: string;
  fields: ImportFieldChange[];
};

export type ImportPreview = {
  snapshot: TournamentSnapshot;
  summary: DataImportSummary;
  fixtureChanges: ImportEntityChange[];
  teamChanges: ImportEntityChange[];
};

const teamFields: Array<{ key: keyof Team; label: string }> = [
  { key: "name", label: "名称" },
  { key: "abbr", label: "缩写" },
  { key: "group", label: "小组" },
  { key: "fifaRank", label: "FIFA 排名" },
  { key: "elo", label: "ELO" },
  { key: "attack", label: "进攻" },
  { key: "defense", label: "防守" },
  { key: "form", label: "状态" },
  { key: "injuries", label: "伤停" },
  { key: "host", label: "东道主" },
  { key: "color", label: "颜色" }
];

const fixtureFields: Array<{ key: keyof Match; label: string }> = [
  { key: "group", label: "小组" },
  { key: "matchday", label: "轮次" },
  { key: "date", label: "日期" },
  { key: "venue", label: "场馆" },
  { key: "homeTeamId", label: "主队" },
  { key: "awayTeamId", label: "客队" },
  { key: "neutral", label: "中立场" },
  { key: "status", label: "状态" },
  { key: "result", label: "比分" },
  { key: "discipline", label: "纪律" }
];

export function previewTournamentImport(
  jsonText: string,
  baseSnapshot: TournamentSnapshot
): ImportPreview {
  const result = importTournamentJson(jsonText, baseSnapshot);

  return {
    snapshot: result.snapshot,
    summary: result.summary,
    fixtureChanges: diffFixtures(baseSnapshot, result.snapshot),
    teamChanges: diffTeams(baseSnapshot, result.snapshot)
  };
}

function diffTeams(
  baseSnapshot: TournamentSnapshot,
  nextSnapshot: TournamentSnapshot
): ImportEntityChange[] {
  const baseTeamsById = new Map(baseSnapshot.teams.map((team) => [team.id, team]));

  return nextSnapshot.teams
    .map((team) => {
      const before = baseTeamsById.get(team.id);
      const fields = before ? diffFields(before, team, teamFields) : allFields(team, teamFields);

      return {
        id: team.id,
        label: `${team.name} (${team.abbr})`,
        fields
      };
    })
    .filter((change) => change.fields.length > 0);
}

function diffFixtures(
  baseSnapshot: TournamentSnapshot,
  nextSnapshot: TournamentSnapshot
): ImportEntityChange[] {
  const baseFixturesById = new Map(baseSnapshot.fixtures.map((fixture) => [fixture.id, fixture]));
  const teamsById = new Map(nextSnapshot.teams.map((team) => [team.id, team]));

  return nextSnapshot.fixtures
    .map((fixture) => {
      const before = baseFixturesById.get(fixture.id);
      const fields = before
        ? diffFields(before, fixture, fixtureFields)
        : allFields(fixture, fixtureFields);

      return {
        id: fixture.id,
        label: buildFixtureLabel(fixture, teamsById),
        fields
      };
    })
    .filter((change) => change.fields.length > 0);
}

function diffFields<T extends object>(
  before: T,
  after: T,
  fields: Array<{ key: keyof T; label: string }>
): ImportFieldChange[] {
  return fields.flatMap(({ key, label }) => {
    const beforeValue = normalizeValue(before[key]);
    const afterValue = normalizeValue(after[key]);

    if (beforeValue === afterValue) {
      return [];
    }

    return [
      {
        field: String(key),
        label,
        before: beforeValue,
        after: afterValue
      }
    ];
  });
}

function allFields<T extends object>(
  item: T,
  fields: Array<{ key: keyof T; label: string }>
): ImportFieldChange[] {
  return fields.flatMap(({ key, label }) => {
    const after = normalizeValue(item[key]);

    if (after === "-") {
      return [];
    }

    return [
      {
        field: String(key),
        label,
        before: "-",
        after
      }
    ];
  });
}

function buildFixtureLabel(match: Match, teamsById: Map<string, Team>): string {
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);

  return `${home?.abbr ?? match.homeTeamId} vs ${away?.abbr ?? match.awayTeamId}`;
}

function normalizeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (isMatchResult(value)) {
    return `${value.homeGoals}-${value.awayGoals}`;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isMatchResult(value: unknown): value is { homeGoals: number; awayGoals: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "homeGoals" in value &&
    "awayGoals" in value &&
    typeof value.homeGoals === "number" &&
    typeof value.awayGoals === "number"
  );
}
