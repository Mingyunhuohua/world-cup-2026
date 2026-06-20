import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildAdapterPackage } from "./core.mjs";

export const fifaRankingsAdapter = {
  id: "fifa-rankings",
  label: "FIFA 男足排名",
  kind: "rankings",
  mode: "mock-or-local",
  sourceUrl: "https://inside.fifa.com/fifa-world-ranking/men",
  notes: "不联网；可读取本地 JSON/CSV 排名表并输出 teamPatches。"
};

export async function runFifaRankingsAdapter(options = {}) {
  if (options.file) {
    const text = await readFile(resolve(options.file), "utf8");
    const teamPatches = parseFifaRankingsSource(text, options.file);

    return buildAdapterPackage(fifaRankingsAdapter, {
      generatedAt: options.generatedAt,
      teamPatches,
      warnings: [
        `已从本地文件解析 ${teamPatches.length} 支球队排名。`,
        "离线排名仍需人工核验球队 ID/缩写与官方排名日期。"
      ]
    });
  }

  return buildAdapterPackage(fifaRankingsAdapter, {
    generatedAt: options.generatedAt,
    teamPatches: [
      { id: "esp", fifaRank: 1 },
      { id: "arg", fifaRank: 2 },
      { id: "fra", fifaRank: 3 },
      { id: "bra", fifaRank: 5 }
    ],
    warnings: ["mock 排名用于验证 teamPatches 导入，正式排名需由官方源刷新。"]
  });
}

export function parseFifaRankingsSource(text, filename = "rankings") {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const extension = extname(filename).toLowerCase();

  if (extension === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseRankingsJson(trimmed);
  }

  return parseRankingsTable(trimmed);
}

function parseRankingsJson(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Invalid rankings JSON.");
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.rankings)
      ? payload.rankings
      : Array.isArray(payload.teams)
        ? payload.teams
        : Array.isArray(payload.teamPatches)
          ? payload.teamPatches
          : [];

  if (rows.length === 0) {
    throw new Error("Rankings JSON must contain an array, rankings, teams, or teamPatches.");
  }

  return rows.map((row, index) => normalizeRankingRow(row, index));
}

function parseRankingsTable(text) {
  const rows = parseDelimited(text);

  if (rows.length < 2) {
    throw new Error("Ranking table must include a header row and at least one data row.");
  }

  const headers = rows[0].map(normalizeHeader);

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row, index) => {
      const record = {};

      for (let column = 0; column < headers.length; column += 1) {
        record[headers[column]] = row[column] ?? "";
      }

      return normalizeRankingRow(record, index);
    });
}

function normalizeRankingRow(row, index) {
  if (!isRecord(row)) {
    throw new Error(`Ranking row ${index + 1} must be an object.`);
  }

  const id = readString(row, "id") ?? readString(row, "teamId");
  const abbr = readString(row, "abbr") ?? readString(row, "code");
  const fifaRank = readNumberFromAliases(row, ["fifaRank", "rank", "position"]);

  if (!id && !abbr) {
    throw new Error(`Ranking row ${index + 1} is missing id, teamId, or abbr.`);
  }

  if (fifaRank === undefined) {
    throw new Error(`Ranking row ${index + 1} is missing fifaRank, rank, or position.`);
  }

  return compactObject({
    ...(id ? { id } : {}),
    ...(abbr ? { abbr: abbr.toUpperCase() } : {}),
    fifaRank,
    elo: readNumberFromAliases(row, ["elo"]),
    attack: readNumberFromAliases(row, ["attack"]),
    defense: readNumberFromAliases(row, ["defense"]),
    form: readNumberFromAliases(row, ["form"]),
    injuries: readNumberFromAliases(row, ["injuries"]),
    name: readString(row, "name") ?? readString(row, "team")
  });
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
    countrycode: "abbr",
    code: "code",
    fifarank: "fifaRank",
    ranking: "rank",
    rank: "rank",
    position: "position",
    teamid: "teamId",
    team: "team",
    country: "team",
    name: "name"
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
    const parsed = Number(value.replace(/,/g, ""));

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([_key, item]) => item !== undefined && item !== "")
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
