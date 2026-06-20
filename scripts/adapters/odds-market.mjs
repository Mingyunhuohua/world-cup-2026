import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildAdapterPackage } from "./core.mjs";

const DEFAULT_FIELD_SIZE = 48;

export const oddsMarketAdapter = {
  id: "odds-market",
  label: "赔率市场",
  kind: "odds",
  mode: "mock-or-local",
  sourceUrl: "manual://odds-market",
  notes: "不联网；可读取本地 JSON/CSV 赔率表，并将市场倾向折算为 form 补丁。"
};

export async function runOddsMarketAdapter(options = {}) {
  if (options.file) {
    const text = await readFile(resolve(options.file), "utf8");
    const teamPatches = parseOddsMarketSource(text, options.file);

    return buildAdapterPackage(oddsMarketAdapter, {
      generatedAt: options.generatedAt,
      teamPatches,
      warnings: [
        `已从本地文件解析 ${teamPatches.length} 支球队赔率信号。`,
        "离线赔率只折算球队级市场状态；正式版本应保留盘口时间、市场类型和原始赔率。"
      ]
    });
  }

  return buildAdapterPackage(oddsMarketAdapter, {
    generatedAt: options.generatedAt,
    teamPatches: [
      { id: "arg", form: 0.16 },
      { id: "esp", form: 0.17 },
      { id: "eng", form: 0.12 },
      { id: "por", form: 0.11 }
    ],
    warnings: ["mock 赔率信号只用于验证接口；正式版本应保留原始赔率和归一化概率。"]
  });
}

export function parseOddsMarketSource(text, filename = "odds") {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const extension = extname(filename).toLowerCase();

  if (extension === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseOddsJson(trimmed);
  }

  return parseOddsTable(trimmed);
}

function parseOddsJson(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Invalid odds JSON.");
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.odds)
      ? payload.odds
      : Array.isArray(payload.markets)
        ? payload.markets
        : Array.isArray(payload.teamPatches)
          ? payload.teamPatches
          : Array.isArray(payload.teams)
            ? payload.teams
            : [];

  if (rows.length === 0) {
    throw new Error("Odds JSON must contain an array, odds, markets, teams, or teamPatches.");
  }

  return rows.map((row, index) => normalizeOddsRow(row, index));
}

function parseOddsTable(text) {
  const rows = parseDelimited(text);

  if (rows.length < 2) {
    throw new Error("Odds table must include a header row and at least one data row.");
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

      return normalizeOddsRow(record, index);
    });
}

function normalizeOddsRow(row, index) {
  if (!isRecord(row)) {
    throw new Error(`Odds row ${index + 1} must be an object.`);
  }

  const id = readString(row, "id") ?? readString(row, "teamId");
  const abbr = readString(row, "abbr") ?? readString(row, "code");
  const probability = readMarketProbability(row);
  const form = readNumberFromAliases(row, [
    "form",
    "marketForm",
    "marketSignal",
    "sentiment"
  ]) ?? (probability === undefined ? undefined : probabilityToForm(probability));
  const attack = readNumberFromAliases(row, ["attack"]);
  const defense = readNumberFromAliases(row, ["defense"]);
  const injuries = readNumberFromAliases(row, ["injuries"]);

  if (!id && !abbr) {
    throw new Error(`Odds row ${index + 1} is missing id, teamId, or abbr.`);
  }

  if (
    form === undefined &&
    attack === undefined &&
    defense === undefined &&
    injuries === undefined
  ) {
    throw new Error(
      `Odds row ${index + 1} is missing form, probability, decimal odds, attack, defense, or injuries.`
    );
  }

  return compactObject({
    ...(id ? { id } : {}),
    ...(abbr ? { abbr: abbr.toUpperCase() } : {}),
    form,
    attack,
    defense,
    injuries,
    name: readString(row, "name") ?? readString(row, "team")
  });
}

function readMarketProbability(row) {
  const directProbability = readNumberFromAliases(row, [
    "probability",
    "probabilityPct",
    "impliedProbability",
    "impliedProbabilityPct",
    "marketProbability",
    "championProbability",
    "titleProbability",
    "outrightProbability",
    "winProbability"
  ]);
  const normalizedProbability = normalizeProbability(directProbability);

  if (normalizedProbability !== undefined) {
    return normalizedProbability;
  }

  const decimalOdds = readNumberFromAliases(row, [
    "odds",
    "decimalOdds",
    "championOdds",
    "titleOdds",
    "outrightOdds"
  ]);

  if (decimalOdds !== undefined && decimalOdds > 1) {
    return clamp(1 / decimalOdds, 0.001, 0.8);
  }

  return undefined;
}

function probabilityToForm(probability) {
  const baseline = 1 / DEFAULT_FIELD_SIZE;
  const safeProbability = clamp(probability, 0.001, 0.8);
  const signal = Math.log(safeProbability / baseline) / Math.log(8);

  return roundTo(clamp(signal * 0.14, -0.18, 0.2), 3);
}

function normalizeProbability(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value > 0 && value <= 1) {
    return value;
  }

  if (value > 1 && value <= 100) {
    return value / 100;
  }

  return undefined;
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
    championodds: "championOdds",
    championprobability: "championProbability",
    championprobabilitypct: "championProbability",
    code: "code",
    country: "team",
    countrycode: "abbr",
    decimalodds: "decimalOdds",
    impliedprobability: "impliedProbability",
    impliedprobabilitypct: "impliedProbabilityPct",
    marketform: "marketForm",
    marketprobability: "marketProbability",
    marketsignal: "marketSignal",
    odds: "odds",
    outrightodds: "outrightOdds",
    outrightprobability: "outrightProbability",
    probability: "probability",
    probabilitypct: "probabilityPct",
    sentiment: "sentiment",
    team: "team",
    teamid: "teamId",
    titleodds: "titleOdds",
    titleprobability: "titleProbability",
    winprobability: "winProbability"
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
