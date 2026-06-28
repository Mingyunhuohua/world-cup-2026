import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "../load-env.mjs";
import { ODDS_API_TEAM_NAME_TO_ABBR } from "./team-name-map.mjs";

export const matchResultsAdapter = {
  id: "match-results",
  label: "真实赛果",
  kind: "results",
  mode: "mock-or-local",
  sourceUrl: "manual://match-results",
  notes: "可联网调用 The Odds API scores 接口拉取最近完赛比分，折算为按球队缩写标注的赛果。"
};

const SCORES_API_BASE_URL =
  "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/scores/";

export async function runMatchResultsAdapter(options = {}) {
  if (!options.live) {
    return {
      label: `${matchResultsAdapter.label} (mock)`,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      adapter: matchResultsAdapter,
      completedResults: [
        { homeAbbr: "ARG", awayAbbr: "AUT", homeGoals: 2, awayGoals: 0 }
      ],
      warnings: ["mock 赛果只用于验证接口；正式版本应使用 --live 拉取真实比分。"]
    };
  }

  await loadEnvFile();
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "未找到 ODDS_API_KEY。请在项目根目录的 .env 文件中设置 ODDS_API_KEY=你的 The Odds API 密钥。"
    );
  }

  const url = `${SCORES_API_BASE_URL}?apiKey=${encodeURIComponent(apiKey)}&daysFrom=3`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`The Odds API scores 请求失败（${response.status}）：${body.slice(0, 300)}`);
  }

  const games = await response.json();
  const { completedResults: freshResults, warnings } = buildCompletedResults(games);
  const requestsRemaining = response.headers.get("x-requests-remaining");

  // The Odds API 的比分接口只返回最近 3 天完赛的比赛。若每次都直接覆盖输出文件，
  // 3 天前踢过的比赛会从结果里"掉出去"，导致新访客看到的赛果不完整。
  // 因此在 --merge 模式下，把本次拉到的新赛果合并进已有的累积文件，老赛果永久保留。
  const existingResults = options.mergeFrom
    ? await readExistingResults(options.mergeFrom)
    : [];
  const completedResults = mergeCompletedResults(existingResults, freshResults);
  const mergeNote =
    options.mergeFrom && existingResults.length > 0
      ? `已与历史累积合并：累计 ${completedResults.length} 场（本次新窗口 ${freshResults.length} 场）。`
      : undefined;

  return {
    label: `${matchResultsAdapter.label} (live)`,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    adapter: { ...matchResultsAdapter, mode: "live", sourceUrl: SCORES_API_BASE_URL },
    completedResults,
    warnings: [
      `已从 The Odds API 拉取 ${games.length} 场比赛，识别出 ${freshResults.length} 场已完赛真实比分。`,
      mergeNote,
      requestsRemaining ? `The Odds API 本月剩余额度：${requestsRemaining} 次请求。` : undefined,
      ...warnings
    ].filter(Boolean)
  };
}

async function readExistingResults(path) {
  try {
    const text = await readFile(resolve(path), "utf8");
    const payload = JSON.parse(text);
    return Array.isArray(payload.completedResults) ? payload.completedResults : [];
  } catch {
    // 文件不存在或损坏时按"无历史"处理，本次拉取的结果就是全部。
    return [];
  }
}

// 以"球队对 + 比赛日期"为键合并：同一场比赛被重复拉到时用最新比分覆盖（可修正比分），
// 历史上记录过但已掉出 3 天窗口的比赛会被保留，从而实现永久累积、不丢数据。
export function mergeCompletedResults(existing, fresh) {
  const keyOf = (result) => {
    const pair = [result.homeAbbr, result.awayAbbr].slice().sort().join("|");
    const day = result.commenceTime ? String(result.commenceTime).slice(0, 10) : "";
    return `${pair}|${day}`;
  };

  const byKey = new Map();
  for (const result of existing ?? []) {
    byKey.set(keyOf(result), result);
  }
  for (const result of fresh ?? []) {
    byKey.set(keyOf(result), result);
  }

  return [...byKey.values()].sort((a, b) =>
    String(a.commenceTime ?? "").localeCompare(String(b.commenceTime ?? ""))
  );
}

export function buildCompletedResults(games) {
  const completedResults = [];
  const unmappedTeamNames = new Set();
  const missingScores = [];

  for (const game of games) {
    if (!game.completed) {
      continue;
    }

    const homeAbbr = ODDS_API_TEAM_NAME_TO_ABBR[game.home_team];
    const awayAbbr = ODDS_API_TEAM_NAME_TO_ABBR[game.away_team];
    if (!homeAbbr) unmappedTeamNames.add(game.home_team);
    if (!awayAbbr) unmappedTeamNames.add(game.away_team);
    if (!homeAbbr || !awayAbbr) {
      continue;
    }

    const scoreByName = new Map((game.scores ?? []).map((entry) => [entry.name, entry.score]));
    const homeGoals = toGoals(scoreByName.get(game.home_team));
    const awayGoals = toGoals(scoreByName.get(game.away_team));
    if (homeGoals === undefined || awayGoals === undefined) {
      missingScores.push(`${game.home_team} vs ${game.away_team}`);
      continue;
    }

    completedResults.push({
      homeAbbr,
      awayAbbr,
      homeGoals,
      awayGoals,
      commenceTime: game.commence_time
    });
  }

  const warnings = [];
  if (unmappedTeamNames.size > 0) {
    warnings.push(`以下球队名称未能匹配内部缩写，已跳过：${[...unmappedTeamNames].join("、")}`);
  }
  if (missingScores.length > 0) {
    warnings.push(`以下比赛标记为完赛但缺少有效比分，已跳过：${missingScores.join("、")}`);
  }

  return { completedResults, warnings };
}

function toGoals(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
