import type { DataProvider, DataSource } from "../types.ts";

export const snapshotCollectedAt = "2026-06-21T12:00:00+08:00";

export const dataProviders: DataProvider[] = [
  {
    id: "fifa-fixtures",
    label: "FIFA 官方赛程",
    kind: "official",
    url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
    updatedAt: "2026-06-19T12:00:00+08:00",
    retrievedAt: snapshotCollectedAt,
    coverage: "赛程、赛事页、官方比分入口",
    status: "active",
    notes: "官方页面由前端渲染，当前前端应用使用手工核验快照，后续应通过后端抓取或 API 代理接入。"
  },
  {
    id: "fifa-ranking",
    label: "FIFA 男足排名",
    kind: "official",
    url: "https://inside.fifa.com/fifa-world-ranking/men",
    updatedAt: "2026-06-11T00:00:00+08:00",
    retrievedAt: snapshotCollectedAt,
    coverage: "FIFA 排名更新时间与排名字段",
    status: "active",
    notes: "FIFA 页面显示最近一次男足排名更新为 2026-06-11，下一次官方更新为 2026-07-20。"
  },
  {
    id: "sbnation-schedule",
    label: "SB Nation 赛程/比分快照",
    kind: "media",
    url: "https://www.sbnation.com/soccer/1117513/world-cup-schedule-2026-how-to-watch-every-match-scores-and-more",
    updatedAt: "2026-06-12T10:50:00Z",
    retrievedAt: snapshotCollectedAt,
    coverage: "完整小组赛列表与开幕日比分",
    status: "fallback",
    notes: "用于补足当前无法直接稳定解析的官方赛程 HTML。"
  },
  {
    id: "guardian-canada-bosnia",
    label: "Guardian 已完赛比分快照",
    kind: "media",
    url: "https://www.theguardian.com/football/2026/jun/14/world-cup-scotland-haiti-steve-clarke",
    updatedAt: "2026-06-19T12:00:00+08:00",
    retrievedAt: snapshotCollectedAt,
    coverage: "截至 2026-06-19 已核验小组赛比分",
    status: "fallback",
    notes: "用于补足官方页面无法稳定解析时的已完赛比分；每场结果仍应以 FIFA 官方赛程页最终口径复核。"
  }
];

export const fifaFixturesSource: DataSource = {
  name: "FIFA official fixtures page",
  kind: "official",
  url: dataProviders[0].url,
  updatedAt: dataProviders[0].updatedAt,
  retrievedAt: snapshotCollectedAt,
  confidence: "verified",
  notes: dataProviders[0].notes
};

export const fifaRankingSource: DataSource = {
  name: "FIFA/Coca-Cola Men's World Ranking",
  kind: "official",
  url: dataProviders[1].url,
  updatedAt: dataProviders[1].updatedAt,
  retrievedAt: snapshotCollectedAt,
  confidence: "verified",
  notes: dataProviders[1].notes
};

export const scheduleFallbackSource: DataSource = {
  name: "Verified media schedule snapshot",
  kind: "media",
  url: dataProviders[2].url,
  updatedAt: dataProviders[2].updatedAt,
  retrievedAt: snapshotCollectedAt,
  confidence: "estimated",
  notes: dataProviders[2].notes
};

export const resultFallbackSource: DataSource = {
  name: "Verified media result snapshot",
  kind: "media",
  url: dataProviders[3].url,
  updatedAt: dataProviders[3].updatedAt,
  retrievedAt: snapshotCollectedAt,
  confidence: "estimated",
  notes: "用于当前已完赛比分，等待官方赛程端点稳定接入后替换。"
};
