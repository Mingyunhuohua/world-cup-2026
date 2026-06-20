import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildAdapterPackage } from "./core.mjs";

export const recentFormAdapter = {
  id: "recent-form",
  label: "近期战绩",
  kind: "recentForm",
  mode: "mock-or-local",
  sourceUrl: "manual://recent-form",
  notes: "不联网；可读取本地 JSON/CSV 近期战绩，并折算为 form、attack、defense 补丁。"
};

export async function runRecentFormAdapter(options = {}) {
  if (options.file) {
    const text = await readFile(resolve(options.file), "utf8");
    const teamPatches = parseRecentFormSource(text, options.file);

    return buildAdapterPackage(recentFormAdapter, {
      generatedAt: options.generatedAt,
      teamPatches,
      warnings: [
        `已从本地文件解析 ${teamPatches.length} 支球队近期战绩。`,
        "近期战绩补丁按球队级样本折算；正式版本应保留比赛日期、对手强度和赛事权重。"
      ]
    });
  }

  return buildAdapterPackage(recentFormAdapter, {
    generatedAt: options.generatedAt,
    teamPatches: [
      { id: "arg", form: 0.14, attack: 1.06 },
      { id: "bra", form: 0.12, attack: 1.05 },
      { id: "ger", form: 0.08, defense: 1.04 },
      { id: "usa", form: 0.06 }
    ],
    warnings: ["mock 近期战绩只用于验证接口；正式版本需按比赛日期和对手强度加权。"]
  });
}

export function parseRecentFormSource(text, filename = "recent-form") {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const extension = extname(filename).toLowerCase();

  if (extension === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseRecentFormJson(trimmed);
  }

  return parseRecentFormTable(trimmed);
}

function parseRecentFormJson(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Invalid recent-form JSON.");
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.recentForm)
      ? payload.recentForm
      : Array.isArray(payload.matches)
        ? payload.matches
        : Array.isArray(payload.results)
          ? payload.results
          : Array.isArray(payload.teamPatches)
            ? payload.teamPatches
            : Array.isArray(payload.teams)
              ? payload.teams
              : [];

  if (rows.length === 0) {
    throw new Error("Recent-form JSON must contain an array, recentForm, matches, results, teams, or teamPatches.");
  }

  return normalizeRecentRows(rows);
}

function parseRecentFormTable(text) {
  const rows = parseDelimited(text);

  if (rows.length < 2) {
    throw new Error("Recent-form table must include a header row and at least one data row.");
  }

  const headers = rows[0].map(normalizeHeader);
  const records = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const record = {};

      for (let column = 0; column < headers.length; column += 1) {
        record[headers[column]] = row[column] ?? "";
      }

      return record;
    });

  return normalizeRecentRows(records);
}

function normalizeRecentRows(rows) {
  const accumulators = new Map();
  const directPatches = [];

  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`Recent-form row ${index + 1} must be an object.`);
    }

    if (isFixtureRow(row)) {
      addFixtureRow(accumulators, row, index);
      return;
    }

    const identity = readIdentity(row);
    if (!identity) {
      throw new Error(`Recent-form row ${index + 1} is missing id, teamId, or abbr.`);
    }

    const directForm = readNumberFromAliases(row, [
      "form",
      "recentForm",
      "formIndex",
      "statusForm"
    ]);

    if (directForm !== undefined && !hasPerformanceStats(row)) {
      directPatches.push(
        compactObject({
          ...identity.toPatch,
          form: directForm,
          attack: readNumberFromAliases(row, ["attack"]),
          defense: readNumberFromAliases(row, ["defense"]),
          injuries: readNumberFromAliases(row, ["injuries"]),
          name: readString(row, "name") ?? readString(row, "team")
        })
      );
      return;
    }

    const stats = readTeamStats(row, index);
    addTeamStats(accumulators, identity, stats, row);
  });

  const derivedPatches = [...accumulators.values()].map(accumulatorToPatch);

  return [...directPatches, ...derivedPatches];
}

function isFixtureRow(row) {
  return (
    (readString(row, "homeTeamId") || readString(row, "homeAbbr")) &&
    (readString(row, "awayTeamId") || readString(row, "awayAbbr")) &&
    readNumberFromAliases(row, ["homeGoals", "homeScore"]) !== undefined &&
    readNumberFromAliases(row, ["awayGoals", "awayScore"]) !== undefined
  );
}

function addFixtureRow(accumulators, row, index) {
  const homeIdentity = readFixtureIdentity(row, "home");
  const awayIdentity = readFixtureIdentity(row, "away");
  const homeGoals = readNumberFromAliases(row, ["homeGoals", "homeScore"]);
  const awayGoals = readNumberFromAliases(row, ["awayGoals", "awayScore"]);

  if (!homeIdentity || !awayIdentity || homeGoals === undefined || awayGoals === undefined) {
    throw new Error(`Fixture row ${index + 1} is missing team IDs or goals.`);
  }

  addTeamStats(accumulators, homeIdentity, statsFromScore(homeGoals, awayGoals), {});
  addTeamStats(accumulators, awayIdentity, statsFromScore(awayGoals, homeGoals), {});
}

function readTeamStats(row, index) {
  const sequence = parseResultSequence(
    readString(row, "lastResults") ??
      readString(row, "results") ??
      readString(row, "result") ??
      readString(row, "formString")
  );
  const sequenceStats = sequence ? statsFromSequence(sequence) : undefined;
  const wins = readNumberFromAliases(row, ["wins", "win", "w"]) ?? sequenceStats?.wins;
  const draws = readNumberFromAliases(row, ["draws", "draw", "d"]) ?? sequenceStats?.draws;
  const losses = readNumberFromAliases(row, ["losses", "loss", "l"]) ?? sequenceStats?.losses;
  const goalsFor = readNumberFromAliases(row, ["goalsFor", "gf", "forGoals", "scored"]);
  const goalsAgainst = readNumberFromAliases(row, ["goalsAgainst", "ga", "againstGoals", "conceded"]);
  let matches = readNumberFromAliases(row, ["matches", "played", "recentMatches", "sample"]);

  if (matches === undefined && wins !== undefined && draws !== undefined && losses !== undefined) {
    matches = wins + draws + losses;
  }

  if (matches === undefined && goalsFor !== undefined && goalsAgainst !== undefined) {
    matches = 1;
  }

  if (matches === undefined || matches <= 0) {
    throw new Error(`Recent-form row ${index + 1} is missing matches, played, results, or score data.`);
  }

  const points =
    readNumberFromAliases(row, ["points", "pts"]) ??
    sequenceStats?.points ??
    inferPoints({ wins, draws, goalsFor, goalsAgainst, matches });

  if (points === undefined && goalsFor === undefined && goalsAgainst === undefined) {
    throw new Error(`Recent-form row ${index + 1} is missing usable performance data.`);
  }

  return {
    matches,
    points: points ?? 0,
    wins: wins ?? 0,
    draws: draws ?? 0,
    losses: losses ?? 0,
    goalsFor: goalsFor ?? 0,
    goalsAgainst: goalsAgainst ?? 0
  };
}

function addTeamStats(accumulators, identity, stats, row) {
  const key = identity.key;
  const current = accumulators.get(key) ?? {
    key,
    toPatch: identity.toPatch,
    name: readString(row, "name") ?? readString(row, "team"),
    matches: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0
  };

  current.matches += stats.matches;
  current.points += stats.points;
  current.wins += stats.wins;
  current.draws += stats.draws;
  current.losses += stats.losses;
  current.goalsFor += stats.goalsFor;
  current.goalsAgainst += stats.goalsAgainst;

  accumulators.set(key, current);
}

function accumulatorToPatch(accumulator) {
  const matches = Math.max(1, accumulator.matches);
  const pointsPerMatch = accumulator.points / matches;
  const goalsForPerMatch = accumulator.goalsFor / matches;
  const goalsAgainstPerMatch = accumulator.goalsAgainst / matches;
  const goalDifferencePerMatch = goalsForPerMatch - goalsAgainstPerMatch;
  const resultSignal = ((pointsPerMatch - 1.5) / 1.5) * 0.16;
  const goalSignal = clamp(goalDifferencePerMatch * 0.04, -0.08, 0.08);
  const form = roundTo(clamp(resultSignal + goalSignal, -0.22, 0.22), 3);
  const attack = roundTo(1 + clamp((goalsForPerMatch - 1.4) * 0.08, -0.08, 0.1), 3);
  const defense = roundTo(1 + clamp((1.2 - goalsAgainstPerMatch) * 0.07, -0.08, 0.1), 3);

  return compactObject({
    ...accumulator.toPatch,
    form,
    attack,
    defense,
    name: accumulator.name
  });
}

function statsFromScore(goalsFor, goalsAgainst) {
  return {
    matches: 1,
    points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
    wins: goalsFor > goalsAgainst ? 1 : 0,
    draws: goalsFor === goalsAgainst ? 1 : 0,
    losses: goalsFor < goalsAgainst ? 1 : 0,
    goalsFor,
    goalsAgainst
  };
}

function parseResultSequence(value) {
  if (!value) {
    return undefined;
  }

  const letters = value
    .toUpperCase()
    .replace(/[^WDL]/g, "")
    .split("");

  return letters.length > 0 ? letters : undefined;
}

function statsFromSequence(sequence) {
  const wins = sequence.filter((item) => item === "W").length;
  const draws = sequence.filter((item) => item === "D").length;
  const losses = sequence.filter((item) => item === "L").length;

  return {
    wins,
    draws,
    losses,
    points: wins * 3 + draws,
    matches: sequence.length
  };
}

function inferPoints({ wins, draws, goalsFor, goalsAgainst, matches }) {
  if (wins !== undefined || draws !== undefined) {
    return (wins ?? 0) * 3 + (draws ?? 0);
  }

  if (matches === 1 && goalsFor !== undefined && goalsAgainst !== undefined) {
    return goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
  }

  return undefined;
}

function hasPerformanceStats(row) {
  return [
    "matches",
    "played",
    "recentMatches",
    "sample",
    "wins",
    "draws",
    "losses",
    "goalsFor",
    "goalsAgainst",
    "gf",
    "ga",
    "points",
    "lastResults",
    "results",
    "formString"
  ].some((key) => row[key] !== undefined && row[key] !== "");
}

function readIdentity(row) {
  const id = readString(row, "id") ?? readString(row, "teamId");
  const abbr = readString(row, "abbr") ?? readString(row, "code");

  if (!id && !abbr) {
    return undefined;
  }

  return {
    key: id ? `id:${id}` : `abbr:${abbr.toUpperCase()}`,
    toPatch: compactObject({
      ...(id ? { id } : {}),
      ...(abbr ? { abbr: abbr.toUpperCase() } : {})
    })
  };
}

function readFixtureIdentity(row, side) {
  const id = readString(row, `${side}TeamId`) ?? readString(row, `${side}Id`);
  const abbr = readString(row, `${side}Abbr`) ?? readString(row, `${side}Code`);

  if (!id && !abbr) {
    return undefined;
  }

  return {
    key: id ? `id:${id}` : `abbr:${abbr.toUpperCase()}`,
    toPatch: compactObject({
      ...(id ? { id } : {}),
      ...(abbr ? { abbr: abbr.toUpperCase() } : {})
    })
  };
}

function parseDelimited(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  rows.push(row);

  return rows.filter((items) => items.some((item) => item.length > 0));
}

function normalizeHeader(value) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = {
    abbreviation: "abbr",
    againstgoals: "goalsAgainst",
    awayabbr: "awayAbbr",
    awaycode: "awayCode",
    awaygoals: "awayGoals",
    awayid: "awayId",
    awayscore: "awayScore",
    awayteamid: "awayTeamId",
    code: "code",
    country: "team",
    countrycode: "abbr",
    forgoals: "goalsFor",
    formindex: "formIndex",
    formstring: "formString",
    ga: "ga",
    gf: "gf",
    goalsagainst: "goalsAgainst",
    goalsfor: "goalsFor",
    homeabbr: "homeAbbr",
    homecode: "homeCode",
    homegoals: "homeGoals",
    homeid: "homeId",
    homescore: "homeScore",
    hometeamid: "homeTeamId",
    lastresults: "lastResults",
    played: "played",
    recentform: "recentForm",
    recentmatches: "recentMatches",
    scored: "scored",
    statusform: "statusForm",
    team: "team",
    teamid: "teamId"
  };

  return aliases[normalized] ?? normalized;
}

function readNumberFromAliases(row, aliases) {
  for (const alias of aliases) {
    const value = readNumber(row, alias);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readString(row, key) {
  const value = row[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(row, key) {
  const value = row[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replace(/[%\s,]/g, ""));

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([_key, item]) => item !== undefined && item !== "")
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value, decimals) {
  const scale = 10 ** decimals;

  return Math.round(value * scale) / scale;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
