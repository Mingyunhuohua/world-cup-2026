import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildAdapterPackage } from "./core.mjs";
import { loadEnvFile } from "../load-env.mjs";

const DEFAULT_FIELD_SIZE = 48;

export const oddsMarketAdapter = {
  id: "odds-market",
  label: "赔率市场",
  kind: "odds",
  mode: "mock-or-local",
  sourceUrl: "manual://odds-market",
  notes: "不联网；可读取本地 JSON/CSV 赔率表，并将市场倾向折算为 form 补丁。"
};

// The Odds API 用英文全称标注球队，需要映射回内部缩写。
// 名称来自 v4/sports/soccer_fifa_world_cup/odds 接口实测返回值，与 data/teams.ts 一一对应。
const ODDS_API_TEAM_NAME_TO_ABBR = {
  Algeria: "ALG",
  Argentina: "ARG",
  Australia: "AUS",
  Austria: "AUT",
  Belgium: "BEL",
  "Bosnia & Herzegovina": "BIH",
  Brazil: "BRA",
  Canada: "CAN",
  "Cape Verde": "CPV",
  Colombia: "COL",
  Croatia: "CRO",
  "Curaçao": "CUW",
  "Czech Republic": "CZE",
  "DR Congo": "COD",
  Ecuador: "ECU",
  Egypt: "EGY",
  England: "ENG",
  France: "FRA",
  Germany: "GER",
  Ghana: "GHA",
  Haiti: "HAI",
  Iran: "IRN",
  Iraq: "IRQ",
  "Ivory Coast": "CIV",
  Japan: "JPN",
  Jordan: "JOR",
  Mexico: "MEX",
  Morocco: "MAR",
  Netherlands: "NED",
  "New Zealand": "NZL",
  Norway: "NOR",
  Panama: "PAN",
  Paraguay: "PAR",
  Portugal: "POR",
  Qatar: "QAT",
  "Saudi Arabia": "KSA",
  Scotland: "SCO",
  Senegal: "SEN",
  "South Africa": "RSA",
  "South Korea": "KOR",
  Spain: "ESP",
  Sweden: "SWE",
  Switzerland: "SUI",
  Tunisia: "TUN",
  Turkey: "TUR",
  USA: "USA",
  Uruguay: "URU",
  Uzbekistan: "UZB"
};

const ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/";

export async function runOddsMarketAdapter(options = {}) {
  if (options.live) {
    return runLiveOddsMarketAdapter(options);
  }

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

async function runLiveOddsMarketAdapter(options) {
  await loadEnvFile();
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "未找到 ODDS_API_KEY。请在项目根目录的 .env 文件中设置 ODDS_API_KEY=你的 The Odds API 密钥。"
    );
  }

  const url = `${ODDS_API_BASE_URL}?apiKey=${encodeURIComponent(apiKey)}&regions=eu&markets=h2h`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`The Odds API 请求失败（${response.status}）：${body.slice(0, 300)}`);
  }

  const matches = await response.json();
  const { teamPatches, warnings } = buildLiveOddsTeamPatches(matches);
  const requestsRemaining = response.headers.get("x-requests-remaining");

  return buildAdapterPackage(
    {
      ...oddsMarketAdapter,
      mode: "live",
      sourceUrl: ODDS_API_BASE_URL,
      notes: "已联网调用 The Odds API 实时赔率（h2h 市场），按欧洲博彩商共识折算为球队 form 信号。"
    },
    {
      generatedAt: options.generatedAt,
      teamPatches,
      warnings: [
        `已从 The Odds API 拉取 ${matches.length} 场比赛的真实赔率，折算出 ${teamPatches.length} 支球队的市场信号。`,
        requestsRemaining ? `The Odds API 本月剩余额度：${requestsRemaining} 次请求。` : undefined,
        "赔率折算为相对中性的市场胜率信号（去除庄家抽水），用于调整 form；非官方夺冠赔率。",
        ...warnings
      ].filter(Boolean)
    }
  );
}

export function buildLiveOddsTeamPatches(matches) {
  const winProbabilitiesByAbbr = new Map();
  const unmappedTeamNames = new Set();

  for (const match of matches) {
    const homeAbbr = ODDS_API_TEAM_NAME_TO_ABBR[match.home_team];
    const awayAbbr = ODDS_API_TEAM_NAME_TO_ABBR[match.away_team];

    if (!homeAbbr) unmappedTeamNames.add(match.home_team);
    if (!awayAbbr) unmappedTeamNames.add(match.away_team);
    if (!homeAbbr || !awayAbbr) {
      continue;
    }

    const consensus = averageH2hProbabilities(
      match.bookmakers ?? [],
      match.home_team,
      match.away_team
    );
    if (!consensus) {
      continue;
    }

    addWinProbability(winProbabilitiesByAbbr, homeAbbr, consensus.home);
    addWinProbability(winProbabilitiesByAbbr, awayAbbr, consensus.away);
  }

  const teamPatches = [...winProbabilitiesByAbbr.entries()].map(([abbr, samples]) => {
    const averageWinProbability = samples.reduce((sum, value) => sum + value, 0) / samples.length;

    return {
      abbr,
      form: matchWinProbabilityToForm(averageWinProbability)
    };
  });

  const warnings =
    unmappedTeamNames.size > 0
      ? [`以下球队名称未能匹配内部缩写，已跳过：${[...unmappedTeamNames].join("、")}`]
      : [];

  return { teamPatches, warnings };
}

function averageH2hProbabilities(bookmakers, homeTeamName, awayTeamName) {
  const homeProbs = [];
  const awayProbs = [];

  for (const bookmaker of bookmakers) {
    const market = bookmaker.markets?.find((item) => item.key === "h2h");
    if (!market) {
      continue;
    }

    const outcomes = market.outcomes ?? [];
    const homePrice = outcomes.find((outcome) => outcome.name === homeTeamName)?.price;
    const awayPrice = outcomes.find((outcome) => outcome.name === awayTeamName)?.price;
    const drawPrice = outcomes.find((outcome) => outcome.name === "Draw")?.price;

    if (!homePrice || !drawPrice || !awayPrice) {
      continue;
    }

    const rawHome = 1 / homePrice;
    const rawDraw = 1 / drawPrice;
    const rawAway = 1 / awayPrice;
    const overround = rawHome + rawDraw + rawAway;

    if (!Number.isFinite(overround) || overround <= 0) {
      continue;
    }

    homeProbs.push(rawHome / overround);
    awayProbs.push(rawAway / overround);
  }

  if (homeProbs.length === 0) {
    return undefined;
  }

  return {
    home: homeProbs.reduce((sum, value) => sum + value, 0) / homeProbs.length,
    away: awayProbs.reduce((sum, value) => sum + value, 0) / awayProbs.length
  };
}

function addWinProbability(map, abbr, probability) {
  const list = map.get(abbr) ?? [];
  list.push(probability);
  map.set(abbr, list);
}

// 把单场胜率折算成 teams.ts 里 form 字段的尺度（约 -0.2 到 0.2）。
// 以三方均势 1/3 为基线，市场认为越强的一方 form 越高；纯粹是启发式折算，不代表精确概率模型。
function matchWinProbabilityToForm(winProbability) {
  const baseline = 1 / 3;
  const signal = (winProbability - baseline) * 0.5;

  return roundTo(clamp(signal, -0.2, 0.2), 3);
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
