import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { buildAdapterPackage } from "./core.mjs";

export const fifaFixturesAdapter = {
  id: "fifa-fixtures",
  label: "FIFA 官方赛程",
  kind: "fixtures",
  mode: "mock-or-local",
  sourceUrl: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
  notes: "不联网；可读取本地 JSON 或带 data-* 属性的 HTML 赛程快照。"
};

export async function runFifaFixturesAdapter(options = {}) {
  if (options.file) {
    const text = await readFile(resolve(options.file), "utf8");
    const fixtures = parseFifaFixturesSource(text, options.file);

    return buildAdapterPackage(fifaFixturesAdapter, {
      generatedAt: options.generatedAt,
      fixtures,
      warnings: [
        `已从本地文件解析 ${fixtures.length} 场赛程。`,
        "离线解析结果仍需人工核验球队 ID、时间和比分。"
      ]
    });
  }

  return buildAdapterPackage(fifaFixturesAdapter, {
    generatedAt: options.generatedAt,
    fixtures: [
      {
        id: "D-1-1",
        date: "2026-06-13T19:00:00Z",
        venue: "Los Angeles Stadium",
        status: "scheduled"
      }
    ],
    warnings: ["mock 数据仅用于验证管线，不代表官方实时赛程。"]
  });
}

export function parseFifaFixturesSource(text, filename = "fixtures") {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const extension = extname(filename).toLowerCase();

  if (extension === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseFixtureJson(trimmed);
  }

  return parseFixtureHtml(trimmed);
}

function parseFixtureJson(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Invalid fixture JSON.");
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.fixtures)
      ? payload.fixtures
      : Array.isArray(payload.matches)
        ? payload.matches
        : [];

  if (rows.length === 0) {
    throw new Error("Fixture JSON must contain an array or fixtures/matches array.");
  }

  return rows.map((row, index) => normalizeFixtureRow(row, index));
}

function parseFixtureHtml(html) {
  const rows = [];
  const tagPattern = /<[^>]+data-match-id=["'][^"']+["'][^>]*>/gi;
  const tags = html.match(tagPattern) ?? [];

  for (const tag of tags) {
    const attrs = readAttributes(tag);
    rows.push(
      normalizeFixtureRow(
        {
          id: attrs.matchId,
          group: attrs.group,
          matchday: parseOptionalNumber(attrs.matchday),
          date: attrs.date,
          venue: attrs.venue,
          homeTeamId: attrs.homeTeamId,
          awayTeamId: attrs.awayTeamId,
          homeGoals: parseOptionalNumber(attrs.homeGoals),
          awayGoals: parseOptionalNumber(attrs.awayGoals),
          status: attrs.status
        },
        rows.length
      )
    );
  }

  if (rows.length === 0) {
    throw new Error("Fixture HTML must include elements with data-match-id attributes.");
  }

  return rows;
}

function normalizeFixtureRow(row, index) {
  if (!isRecord(row)) {
    throw new Error(`Fixture row ${index + 1} must be an object.`);
  }

  const id = readString(row, "id") ?? readString(row, "matchId");
  if (!id) {
    throw new Error(`Fixture row ${index + 1} is missing id or matchId.`);
  }

  const result = readResult(row);
  const status = readString(row, "status") ?? (result ? "completed" : "scheduled");

  return {
    id,
    ...(readString(row, "group") ? { group: readString(row, "group") } : {}),
    ...(readNumber(row, "matchday") !== undefined ? { matchday: readNumber(row, "matchday") } : {}),
    ...(readString(row, "date") ? { date: readString(row, "date") } : {}),
    ...(readString(row, "venue") ? { venue: readString(row, "venue") } : {}),
    ...(readString(row, "homeTeamId") ? { homeTeamId: readString(row, "homeTeamId") } : {}),
    ...(readString(row, "awayTeamId") ? { awayTeamId: readString(row, "awayTeamId") } : {}),
    status,
    ...(result ? { homeGoals: result.homeGoals, awayGoals: result.awayGoals, result } : {})
  };
}

function readAttributes(tag) {
  const attrs = {};
  const attrPattern = /\s(data-[a-z0-9-]+)=["']([^"']*)["']/gi;
  let match;

  while ((match = attrPattern.exec(tag))) {
    attrs[toCamelCase(match[1].slice(5))] = decodeHtml(match[2]);
  }

  return attrs;
}

function readResult(row) {
  if (isRecord(row.result)) {
    const homeGoals = readNumber(row.result, "homeGoals");
    const awayGoals = readNumber(row.result, "awayGoals");

    if (homeGoals !== undefined && awayGoals !== undefined) {
      return { homeGoals, awayGoals };
    }
  }

  const homeGoals = readNumber(row, "homeGoals");
  const awayGoals = readNumber(row, "awayGoals");

  if (homeGoals === undefined || awayGoals === undefined) {
    return undefined;
  }

  return { homeGoals, awayGoals };
}

function readString(row, key) {
  const value = row[key];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(row, key) {
  const value = row[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalNumber(value) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function toCamelCase(value) {
  return value.replace(/-([a-z0-9])/g, (_match, letter) => letter.toUpperCase());
}

function decodeHtml(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
