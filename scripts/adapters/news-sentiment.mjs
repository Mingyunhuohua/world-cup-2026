import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildAdapterPackage } from "./core.mjs";

export const newsSentimentAdapter = {
  id: "news-sentiment",
  label: "新闻/舆情",
  kind: "news",
  mode: "mock-or-local",
  sourceUrl: "manual://news-sentiment",
  notes: "不联网；可读取本地 JSON/CSV 新闻情绪、热度、风险和伤停提及，并折算为 form、injuries 补丁。"
};

export async function runNewsSentimentAdapter(options = {}) {
  if (options.file) {
    const text = await readFile(resolve(options.file), "utf8");
    const teamPatches = parseNewsSentimentSource(text, options.file);

    return buildAdapterPackage(newsSentimentAdapter, {
      generatedAt: options.generatedAt,
      teamPatches,
      warnings: [
        `已从本地文件解析 ${teamPatches.length} 支球队新闻/舆情信号。`,
        "新闻信号为球队级折算值；正式版本应保留新闻来源、发布时间、语言和去重规则。"
      ]
    });
  }

  return buildAdapterPackage(newsSentimentAdapter, {
    generatedAt: options.generatedAt,
    teamPatches: [
      { id: "fra", form: 0.08 },
      { id: "eng", form: 0.06 },
      { id: "usa", injuries: 0.05 },
      { id: "mex", form: -0.04 }
    ],
    warnings: ["mock 新闻/舆情信号只用于验证接口；正式版本需接入新闻源、名单源和情绪打分。"]
  });
}

export function parseNewsSentimentSource(text, filename = "news-sentiment") {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const extension = extname(filename).toLowerCase();

  if (extension === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseNewsSentimentJson(trimmed);
  }

  return parseNewsSentimentTable(trimmed);
}

function parseNewsSentimentJson(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Invalid news-sentiment JSON.");
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.news)
      ? payload.news
      : Array.isArray(payload.sentiment)
        ? payload.sentiment
        : Array.isArray(payload.articles)
          ? payload.articles
          : Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.teamPatches)
              ? payload.teamPatches
              : Array.isArray(payload.teams)
                ? payload.teams
                : [];

  if (rows.length === 0) {
    throw new Error("News-sentiment JSON must contain an array, news, sentiment, articles, items, teams, or teamPatches.");
  }

  return normalizeNewsRows(rows);
}

function parseNewsSentimentTable(text) {
  const rows = parseDelimited(text);

  if (rows.length < 2) {
    throw new Error("News-sentiment table must include a header row and at least one data row.");
  }

  const headers = rows[0].map(normalizeHeader);

  return normalizeNewsRows(
    rows
      .slice(1)
      .filter((row) => row.some((cell) => cell.trim().length > 0))
      .map((row) => {
        const record = {};

        for (let column = 0; column < headers.length; column += 1) {
          record[headers[column]] = row[column] ?? "";
        }

        return record;
      })
  );
}

function normalizeNewsRows(rows) {
  const accumulators = new Map();
  const directPatches = [];

  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`News row ${index + 1} must be an object.`);
    }

    const identity = readIdentity(row);
    if (!identity) {
      throw new Error(`News row ${index + 1} is missing id, teamId, or abbr.`);
    }

    const directForm = readNumberFromAliases(row, [
      "form",
      "newsForm",
      "sentimentForm",
      "sentimentSignal"
    ]);
    const directInjuries = readNumberFromAliases(row, [
      "injuries",
      "injuryLoad",
      "injurySignal",
      "injuryScore"
    ]);

    if ((directForm !== undefined || directInjuries !== undefined) && !hasNewsSignals(row)) {
      directPatches.push(
        compactObject({
          ...identity.toPatch,
          form: directForm,
          injuries: directInjuries,
          attack: readNumberFromAliases(row, ["attack"]),
          defense: readNumberFromAliases(row, ["defense"]),
          name: readString(row, "name") ?? readString(row, "team")
        })
      );
      return;
    }

    const stats = readNewsStats(row, index);
    addNewsStats(accumulators, identity, stats, row);
  });

  const derivedPatches = [...accumulators.values()].map(accumulatorToPatch);

  return [...directPatches, ...derivedPatches];
}

function readNewsStats(row, index) {
  const sentiment = readSentimentSignal(row);
  const hype = readZeroOneFromAliases(row, [
    "hype",
    "heat",
    "mediaHeat",
    "publicHeat",
    "buzz",
    "attention",
    "mentionShare"
  ]);
  const risk = readRiskSignal(row);
  const injurySignal = readInjurySignal(row);
  const hasFormSignal = sentiment !== undefined || hype !== undefined || risk !== undefined;
  const hasInjurySignal = injurySignal !== undefined;

  if (!hasFormSignal && !hasInjurySignal) {
    throw new Error(`News row ${index + 1} is missing sentiment, hype, risk, injury, form, or injuries signal.`);
  }

  return {
    sentiment: sentiment ?? 0,
    hype: hype ?? 0.5,
    risk: risk ?? 0,
    injurySignal: injurySignal ?? 0,
    hasFormSignal,
    hasInjurySignal,
    weight: readWeight(row)
  };
}

function addNewsStats(accumulators, identity, stats, row) {
  const current = accumulators.get(identity.key) ?? {
    key: identity.key,
    toPatch: identity.toPatch,
    name: readString(row, "name") ?? readString(row, "team"),
    formWeight: 0,
    sentimentTotal: 0,
    hypeTotal: 0,
    riskTotal: 0,
    injuryWeight: 0,
    injuryTotal: 0
  };

  if (stats.hasFormSignal) {
    current.formWeight += stats.weight;
    current.sentimentTotal += stats.sentiment * stats.weight;
    current.hypeTotal += stats.hype * stats.weight;
    current.riskTotal += stats.risk * stats.weight;
  }

  if (stats.hasInjurySignal) {
    current.injuryWeight += stats.weight;
    current.injuryTotal += stats.injurySignal * stats.weight;
  }

  accumulators.set(identity.key, current);
}

function accumulatorToPatch(accumulator) {
  const form =
    accumulator.formWeight > 0
      ? formFromSignals({
          sentiment: accumulator.sentimentTotal / accumulator.formWeight,
          hype: accumulator.hypeTotal / accumulator.formWeight,
          risk: accumulator.riskTotal / accumulator.formWeight
        })
      : undefined;
  const injuries =
    accumulator.injuryWeight > 0
      ? roundTo(clamp((accumulator.injuryTotal / accumulator.injuryWeight) * 0.18, 0, 0.22), 3)
      : undefined;

  return compactObject({
    ...accumulator.toPatch,
    form,
    injuries,
    name: accumulator.name
  });
}

function formFromSignals({ sentiment, hype, risk }) {
  const signal = sentiment * 0.12 + (hype - 0.5) * 0.04 - risk * 0.06;

  return roundTo(clamp(signal, -0.16, 0.16), 3);
}

function readSentimentSignal(row) {
  const numeric = readNumberFromAliases(row, [
    "sentiment",
    "sentimentScore",
    "sentimentIndex",
    "sentimentPolarity",
    "toneScore"
  ]);
  const normalized = normalizeSentiment(numeric);

  if (normalized !== undefined) {
    return normalized;
  }

  return toneToSentiment(
    readString(row, "tone") ??
      readString(row, "sentimentLabel") ??
      readString(row, "label") ??
      readString(row, "stance")
  );
}

function readRiskSignal(row) {
  const numeric = readZeroOneFromAliases(row, [
    "risk",
    "riskScore",
    "controversy",
    "pressure",
    "negativePressure",
    "disruption"
  ]);

  if (numeric !== undefined) {
    return numeric;
  }

  return categoryToRisk(
    readString(row, "category") ??
      readString(row, "topic") ??
      readString(row, "status") ??
      readString(row, "headline")
  );
}

function readInjurySignal(row) {
  const direct = readZeroOneFromAliases(row, [
    "injuries",
    "injuryLoad",
    "injuryRisk",
    "injurySignal",
    "injuryScore",
    "absenceRisk",
    "suspensionRisk"
  ]);

  if (direct !== undefined) {
    return direct;
  }

  const injuryMentions = readNumberFromAliases(row, [
    "injuryMentions",
    "injuryCount",
    "absenceMentions",
    "suspensionMentions"
  ]);
  const mentions = readNumberFromAliases(row, [
    "mentions",
    "totalMentions",
    "articleCount",
    "count"
  ]);

  if (injuryMentions !== undefined) {
    return mentions && mentions > 0 ? clamp(injuryMentions / mentions, 0, 1) : clamp(injuryMentions, 0, 1);
  }

  return categoryToInjurySignal(
    readString(row, "category") ??
      readString(row, "topic") ??
      readString(row, "status") ??
      readString(row, "headline")
  );
}

function readWeight(row) {
  const value = readNumberFromAliases(row, [
    "weight",
    "importance",
    "impact",
    "sourceWeight",
    "confidence"
  ]);

  if (value === undefined) {
    return 1;
  }

  return clamp(value, 0.2, 10);
}

function hasNewsSignals(row) {
  return [
    "sentiment",
    "sentimentScore",
    "sentimentIndex",
    "sentimentPolarity",
    "tone",
    "sentimentLabel",
    "hype",
    "heat",
    "mediaHeat",
    "publicHeat",
    "buzz",
    "attention",
    "risk",
    "riskScore",
    "controversy",
    "pressure",
    "injuryMentions",
    "injuryCount",
    "absenceMentions",
    "suspensionMentions",
    "injuryRisk",
    "absenceRisk",
    "suspensionRisk",
    "category",
    "topic",
    "status",
    "headline"
  ].some((key) => row[key] !== undefined && row[key] !== "");
}

function readIdentity(row) {
  const id = readString(row, "id") ?? readString(row, "teamId");
  const abbr = readString(row, "abbr") ?? readString(row, "code") ?? readString(row, "teamAbbr");

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

function normalizeSentiment(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value >= -1 && value <= 1) {
    return value;
  }

  if (value >= -100 && value <= 100) {
    return value / 100;
  }

  return undefined;
}

function toneToSentiment(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["positive", "optimistic", "bullish", "good", "upbeat"].includes(normalized)) {
    return 0.6;
  }

  if (["negative", "pessimistic", "bearish", "bad", "critical"].includes(normalized)) {
    return -0.6;
  }

  if (["neutral", "mixed", "balanced"].includes(normalized)) {
    return 0;
  }

  return undefined;
}

function categoryToRisk(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (/(controversy|pressure|crisis|dispute|discipline|negative|争议|压力|危机|负面)/.test(normalized)) {
    return 0.55;
  }

  return undefined;
}

function categoryToInjurySignal(value) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (/(injury|injured|absence|unavailable|doubtful|伤|缺阵|出战成疑)/.test(normalized)) {
    return 0.65;
  }

  if (/(suspension|suspended|ban|停赛|禁赛)/.test(normalized)) {
    return 0.5;
  }

  return undefined;
}

function readZeroOneFromAliases(row, aliases) {
  const value = readNumberFromAliases(row, aliases);

  return normalizeZeroOne(value);
}

function normalizeZeroOne(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value >= 0 && value <= 1) {
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
    absencerisk: "absenceRisk",
    absencementions: "absenceMentions",
    articlecount: "articleCount",
    code: "code",
    country: "team",
    countrycode: "abbr",
    injurycount: "injuryCount",
    injuryload: "injuryLoad",
    injurymentions: "injuryMentions",
    injuryrisk: "injuryRisk",
    injuryscore: "injuryScore",
    injurysignal: "injurySignal",
    mediaheat: "mediaHeat",
    mentioncount: "mentions",
    mentionshare: "mentionShare",
    negativepressure: "negativePressure",
    newsform: "newsForm",
    publicheat: "publicHeat",
    riskscore: "riskScore",
    sentimentform: "sentimentForm",
    sentimentindex: "sentimentIndex",
    sentimentlabel: "sentimentLabel",
    sentimentpolarity: "sentimentPolarity",
    sentimentscore: "sentimentScore",
    sentimentsignal: "sentimentSignal",
    sourceweight: "sourceWeight",
    suspensionmentions: "suspensionMentions",
    suspensionrisk: "suspensionRisk",
    team: "team",
    teamabbr: "teamAbbr",
    teamid: "teamId",
    tonescore: "toneScore",
    totalmentions: "totalMentions"
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
