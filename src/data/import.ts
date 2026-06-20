import type {
  DataImportSummary,
  DataProvider,
  DisciplineRecord,
  MatchDiscipline,
  Match,
  MatchResult,
  Team,
  TournamentSnapshot
} from "../types.ts";
import { validateTournamentSnapshot } from "./quality.ts";

type ImportResult = {
  snapshot: TournamentSnapshot;
  summary: DataImportSummary;
};

type ImportCounters = {
  importedFixtures: number;
  importedResults: number;
  importedTeams: number;
  importedDiscipline: number;
  warnings: string[];
};

const importSourceId = "manual-json-import";

export function importTournamentJson(
  jsonText: string,
  baseSnapshot: TournamentSnapshot
): ImportResult {
  const payload = parseJsonObject(jsonText);
  const appliedAt = new Date().toISOString();
  const label =
    readString(payload, "label") ??
    readString(payload, "name") ??
    `手工 JSON 导入 ${new Date(appliedAt).toLocaleString("zh-CN")}`;

  const fullSnapshot = tryBuildFullSnapshot(payload, baseSnapshot, appliedAt, label);
  if (fullSnapshot) {
    return fullSnapshot;
  }

  const counters: ImportCounters = {
    importedFixtures: 0,
    importedResults: 0,
    importedTeams: 0,
    importedDiscipline: 0,
    warnings: []
  };
  const teamPatches = readArray(payload, "teamPatches") ?? readArray(payload, "teams");
  const teams = mergeTeamPatches(baseSnapshot.teams, teamPatches, counters);
  let fixtures = mergeFixturePatches(baseSnapshot.fixtures, readArray(payload, "fixtures"), counters);
  fixtures = mergeResultPatches(fixtures, readArray(payload, "results"), counters);
  fixtures = mergeResultPatches(fixtures, readArray(payload, "matches"), counters);

  if (
    counters.importedFixtures === 0 &&
    counters.importedResults === 0 &&
    counters.importedTeams === 0 &&
    counters.importedDiscipline === 0
  ) {
    throw new Error("JSON 中没有可导入的 fixtures、results、teamPatches 或完整快照。");
  }

  const snapshot = finalizeSnapshot(
    {
      ...baseSnapshot,
      id: `${baseSnapshot.id}-manual-import`,
      label,
      collectedAt: appliedAt,
      teams,
      fixtures,
      sources: mergeImportSource(baseSnapshot.sources, appliedAt, counters)
    },
    counters,
    appliedAt,
    label
  );

  return {
    snapshot,
    summary: {
      importedFixtures: counters.importedFixtures,
      importedResults: counters.importedResults,
      importedTeams: counters.importedTeams,
      importedDiscipline: counters.importedDiscipline,
      warnings: counters.warnings,
      appliedAt,
      label
    }
  };
}

function tryBuildFullSnapshot(
  payload: Record<string, unknown>,
  baseSnapshot: TournamentSnapshot,
  appliedAt: string,
  label: string
): ImportResult | null {
  const teams = readArray(payload, "teams");
  const fixtures = readArray(payload, "fixtures");

  if (!teams || !fixtures) {
    return null;
  }

  const parsedTeams = teams.map(parseTeam);
  const parsedFixtures = fixtures.map(parseMatch);
  const counters: ImportCounters = {
    importedFixtures: parsedFixtures.length,
    importedResults: parsedFixtures.filter((fixture) => fixture.result).length,
    importedTeams: parsedTeams.length,
    importedDiscipline: parsedFixtures.filter((fixture) => fixture.discipline).length,
    warnings: []
  };
  const snapshot = finalizeSnapshot(
    {
      id: readString(payload, "id") ?? `${baseSnapshot.id}-manual-import`,
      label,
      collectedAt: readString(payload, "collectedAt") ?? appliedAt,
      teams: parsedTeams,
      fixtures: parsedFixtures,
      sources: mergeImportSource(baseSnapshot.sources, appliedAt, counters),
      completedMatches: 0,
      scheduledMatches: 0,
      notes: [
        ...baseSnapshot.notes,
        "当前运行态数据包含手工 JSON 导入内容；刷新页面后会回到内置快照。"
      ]
    },
    counters,
    appliedAt,
    label
  );

  return {
    snapshot,
    summary: {
      importedFixtures: counters.importedFixtures,
      importedResults: counters.importedResults,
      importedTeams: counters.importedTeams,
      importedDiscipline: counters.importedDiscipline,
      warnings: counters.warnings,
      appliedAt,
      label
    }
  };
}

function finalizeSnapshot(
  snapshot: TournamentSnapshot,
  counters: ImportCounters,
  appliedAt: string,
  label: string
): TournamentSnapshot {
  const completedMatches = snapshot.fixtures.filter(
    (fixture) => fixture.status === "completed" && fixture.result
  ).length;
  const nextSnapshot = {
    ...snapshot,
    label,
    collectedAt: appliedAt,
    completedMatches,
    scheduledMatches: snapshot.fixtures.length - completedMatches
  };
  const failures = validateTournamentSnapshot(nextSnapshot).filter((check) => check.level === "fail");

  if (failures.length > 0) {
    counters.warnings.push(`导入后仍有 ${failures.length} 个质量失败项。`);
  }

  return nextSnapshot;
}

function mergeFixturePatches(
  fixtures: Match[],
  patches: unknown[] | undefined,
  counters: ImportCounters
): Match[] {
  if (!patches) {
    return fixtures;
  }

  const patchesById = new Map<string, Record<string, unknown>>();

  for (const patch of patches) {
    if (!isRecord(patch)) {
      counters.warnings.push("已跳过非对象 fixture。");
      continue;
    }

    const id = readString(patch, "id");
    if (!id) {
      counters.warnings.push("已跳过缺少 id 的 fixture。");
      continue;
    }

    patchesById.set(id, patch);
  }

  return fixtures.map((fixture) => {
    const patch = patchesById.get(fixture.id);
    if (!patch) {
      return fixture;
    }

    counters.importedFixtures += 1;
    const result = readResult(patch);
    const discipline = readDiscipline(patch);
    if (result) {
      counters.importedResults += 1;
    }
    if (discipline) {
      counters.importedDiscipline += 1;
    }

    return {
      ...fixture,
      group: readString(patch, "group") ?? fixture.group,
      matchday: readNumber(patch, "matchday") ?? fixture.matchday,
      date: readString(patch, "date") ?? fixture.date,
      venue: readString(patch, "venue") ?? fixture.venue,
      homeTeamId: readString(patch, "homeTeamId") ?? fixture.homeTeamId,
      awayTeamId: readString(patch, "awayTeamId") ?? fixture.awayTeamId,
      neutral: readBoolean(patch, "neutral") ?? fixture.neutral,
      status: readMatchStatus(patch) ?? (result ? "completed" : fixture.status),
      result: result ?? fixture.result,
      discipline: discipline ?? fixture.discipline,
      source: fixture.source
    };
  });
}

function mergeTeamPatches(
  teams: Team[],
  patches: unknown[] | undefined,
  counters: ImportCounters
): Team[] {
  if (!patches) {
    return teams;
  }

  const teamsByAbbr = new Map(teams.map((team) => [team.abbr.toLowerCase(), team.id]));
  const patchesById = new Map<string, Record<string, unknown>>();

  for (const patch of patches) {
    if (!isRecord(patch)) {
      counters.warnings.push("已跳过非对象球队补丁。");
      continue;
    }

    const rawId = readString(patch, "id") ?? readString(patch, "teamId");
    const abbr = readString(patch, "abbr");
    const id = rawId ?? (abbr ? teamsByAbbr.get(abbr.toLowerCase()) : undefined);

    if (!id) {
      counters.warnings.push("已跳过缺少 id/teamId/abbr 的球队补丁。");
      continue;
    }

    patchesById.set(id, patch);
  }

  return teams.map((team) => {
    const patch = patchesById.get(team.id);
    if (!patch) {
      return team;
    }

    counters.importedTeams += 1;

    return {
      ...team,
      name: readString(patch, "name") ?? team.name,
      abbr: readString(patch, "abbr") ?? team.abbr,
      group: readString(patch, "group") ?? team.group,
      fifaRank: readNumber(patch, "fifaRank") ?? team.fifaRank,
      elo: readNumber(patch, "elo") ?? team.elo,
      attack: readNumber(patch, "attack") ?? team.attack,
      defense: readNumber(patch, "defense") ?? team.defense,
      form: readNumber(patch, "form") ?? team.form,
      injuries: readNumber(patch, "injuries") ?? team.injuries,
      host: readBoolean(patch, "host") ?? team.host,
      color: readString(patch, "color") ?? team.color
    };
  });
}

function mergeResultPatches(
  fixtures: Match[],
  patches: unknown[] | undefined,
  counters: ImportCounters
): Match[] {
  if (!patches) {
    return fixtures;
  }

  const patchById = new Map<string, Record<string, unknown>>();

  for (const patch of patches) {
    if (!isRecord(patch)) {
      counters.warnings.push("已跳过非对象赛果。");
      continue;
    }

    const id = readString(patch, "matchId") ?? readString(patch, "id");
    if (!id) {
      counters.warnings.push("已跳过缺少 matchId/id 的赛果。");
      continue;
    }

    patchById.set(id, patch);
  }

  return fixtures.map((fixture) => {
    const patch = patchById.get(fixture.id);
    if (!patch) {
      return fixture;
    }

    const result = readResult(patch);
    const discipline = readDiscipline(patch);
    if (!result && !discipline) {
      counters.warnings.push(`已跳过 ${fixture.id} 的无效比分或纪律数据。`);
      return fixture;
    }

    if (result) {
      counters.importedResults += 1;
    }
    if (discipline) {
      counters.importedDiscipline += 1;
    }

    return {
      ...fixture,
      status: readMatchStatus(patch) ?? (result ? "completed" : fixture.status),
      result: result ?? fixture.result,
      discipline: discipline ?? fixture.discipline
    };
  });
}

function parseJsonObject(jsonText: string): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(jsonText);
    if (!isRecord(payload)) {
      throw new Error("JSON 根节点必须是对象。");
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === "JSON 根节点必须是对象。") {
      throw error;
    }

    throw new Error("JSON 格式无效，无法解析。");
  }
}

function parseTeam(value: unknown): Team {
  if (!isRecord(value)) {
    throw new Error("完整快照中的 teams 必须是对象数组。");
  }

  const id = readRequiredString(value, "id", "球队缺少 id。");
  const name = readRequiredString(value, "name", `球队 ${id} 缺少 name。`);
  const abbr = readRequiredString(value, "abbr", `球队 ${id} 缺少 abbr。`);
  const group = readRequiredString(value, "group", `球队 ${id} 缺少 group。`);

  return {
    id,
    name,
    abbr,
    group,
    fifaRank: readRequiredNumber(value, "fifaRank", `球队 ${id} 缺少 fifaRank。`),
    elo: readRequiredNumber(value, "elo", `球队 ${id} 缺少 elo。`),
    attack: readRequiredNumber(value, "attack", `球队 ${id} 缺少 attack。`),
    defense: readRequiredNumber(value, "defense", `球队 ${id} 缺少 defense。`),
    form: readRequiredNumber(value, "form", `球队 ${id} 缺少 form。`),
    injuries: readRequiredNumber(value, "injuries", `球队 ${id} 缺少 injuries。`),
    host: readBoolean(value, "host"),
    color: readString(value, "color") ?? "#2f7d59",
    source: isRecord(value.source) ? (value.source as Team["source"]) : buildImportSource(new Date().toISOString(), "完整球队导入")
  };
}

function parseMatch(value: unknown): Match {
  if (!isRecord(value)) {
    throw new Error("完整快照中的 fixtures 必须是对象数组。");
  }

  const id = readRequiredString(value, "id", "比赛缺少 id。");
  const result = readResult(value);
  const discipline = readDiscipline(value);

  return {
    id,
    round: (readString(value, "round") ?? "GROUP") as Match["round"],
    group: readString(value, "group"),
    matchday: readNumber(value, "matchday"),
    date: readRequiredString(value, "date", `比赛 ${id} 缺少 date。`),
    venue: readRequiredString(value, "venue", `比赛 ${id} 缺少 venue。`),
    homeTeamId: readRequiredString(value, "homeTeamId", `比赛 ${id} 缺少 homeTeamId。`),
    awayTeamId: readRequiredString(value, "awayTeamId", `比赛 ${id} 缺少 awayTeamId。`),
    neutral: readBoolean(value, "neutral") ?? true,
    status: readMatchStatus(value) ?? (result ? "completed" : "scheduled"),
    result,
    discipline,
    source: isRecord(value.source) ? (value.source as Match["source"]) : buildImportSource(new Date().toISOString(), "完整赛程导入")
  };
}

function mergeImportSource(
  sources: DataProvider[],
  appliedAt: string,
  counters: ImportCounters
): DataProvider[] {
  return [
    ...sources.filter((source) => source.id !== importSourceId),
    {
      id: importSourceId,
      label: "手工 JSON 导入",
      kind: "manual",
      url: "local://manual-json-import",
      updatedAt: appliedAt,
      retrievedAt: appliedAt,
      coverage: `${counters.importedFixtures} 场赛程更新，${counters.importedResults} 条赛果更新，${counters.importedDiscipline} 条纪律数据更新，${counters.importedTeams} 支球队更新`,
      status: "active",
      notes: counters.warnings.length > 0 ? counters.warnings.join("；") : "运行态导入，刷新页面后不会持久化。"
    }
  ];
}

function buildImportSource(updatedAt: string, notes: string): Match["source"] {
  return {
    name: "Manual JSON import",
    kind: "manual",
    updatedAt,
    retrievedAt: updatedAt,
    confidence: "estimated",
    notes
  };
}

function readDiscipline(record: Record<string, unknown>): MatchDiscipline | undefined {
  const nested = record.discipline;

  if (isRecord(nested)) {
    const home = readDisciplineRecord(nested.home);
    const away = readDisciplineRecord(nested.away);

    if (home || away) {
      return {
        home: home ?? {},
        away: away ?? {}
      };
    }
  }

  const home = readDisciplineRecord(record, "home");
  const away = readDisciplineRecord(record, "away");

  if (!home && !away) {
    return undefined;
  }

  return {
    home: home ?? {},
    away: away ?? {}
  };
}

function readDisciplineRecord(
  value: unknown,
  prefix?: "away" | "home"
): DisciplineRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const yellowCards =
    readNumber(value, prefix ? `${prefix}YellowCards` : "yellowCards") ??
    readNumber(value, prefix ? `${prefix}Yellows` : "yellows");
  const secondYellowReds =
    readNumber(value, prefix ? `${prefix}SecondYellowReds` : "secondYellowReds") ??
    readNumber(value, prefix ? `${prefix}SecondYellowRedCards` : "secondYellowRedCards");
  const directRedCards =
    readNumber(value, prefix ? `${prefix}DirectRedCards` : "directRedCards") ??
    readNumber(value, prefix ? `${prefix}Reds` : "reds") ??
    readNumber(value, prefix ? `${prefix}RedCards` : "redCards");
  const yellowThenDirectReds =
    readNumber(value, prefix ? `${prefix}YellowThenDirectReds` : "yellowThenDirectReds") ??
    readNumber(value, prefix ? `${prefix}YellowThenDirectRedCards` : "yellowThenDirectRedCards");

  if (
    yellowCards === undefined &&
    secondYellowReds === undefined &&
    directRedCards === undefined &&
    yellowThenDirectReds === undefined
  ) {
    return undefined;
  }

  const record: DisciplineRecord = {};

  if (yellowCards !== undefined) record.yellowCards = yellowCards;
  if (secondYellowReds !== undefined) record.secondYellowReds = secondYellowReds;
  if (directRedCards !== undefined) record.directRedCards = directRedCards;
  if (yellowThenDirectReds !== undefined) record.yellowThenDirectReds = yellowThenDirectReds;

  return record;
}

function readResult(record: Record<string, unknown>): MatchResult | undefined {
  const nested = record.result;

  if (isRecord(nested)) {
    const homeGoals = readNumber(nested, "homeGoals");
    const awayGoals = readNumber(nested, "awayGoals");

    if (homeGoals !== undefined && awayGoals !== undefined) {
      return { homeGoals, awayGoals };
    }
  }

  const homeGoals = readNumber(record, "homeGoals");
  const awayGoals = readNumber(record, "awayGoals");

  if (homeGoals === undefined || awayGoals === undefined) {
    return undefined;
  }

  return { homeGoals, awayGoals };
}

function readMatchStatus(record: Record<string, unknown>): Match["status"] | undefined {
  const value = readString(record, "status");

  if (value === "scheduled" || value === "completed") {
    return value;
  }

  return undefined;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];

  return Array.isArray(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  message: string
): string {
  const value = readString(record, key);

  if (!value) {
    throw new Error(message);
  }

  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRequiredNumber(
  record: Record<string, unknown>,
  key: string,
  message: string
): number {
  const value = readNumber(record, key);

  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];

  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
