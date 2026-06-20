import type {
  DataFeedResult,
  DataProvider,
  DataSource,
  DataUpdateReport,
  Match,
  Team,
  TournamentSnapshot
} from "../../types.ts";
import { validateTournamentSnapshot } from "../quality.ts";
import { currentTournamentSnapshot } from "../snapshot.ts";
import { dataProviders } from "../sources.ts";

export type RemoteDataSnapshot = {
  source: DataSource;
  teams: Team[];
  fixtures: Match[];
};

export type TournamentDataAdapter = {
  id: string;
  label: string;
  provider: DataProvider;
  fetchSnapshot: () => Promise<TournamentSnapshot>;
  fetchFixtures: () => Promise<DataFeedResult>;
  fetchRankings: () => Promise<DataFeedResult>;
  fetchInjuries: () => Promise<DataFeedResult>;
  fetchOdds: () => Promise<DataFeedResult>;
  fetchRecentForm: () => Promise<DataFeedResult>;
  fetchNews: () => Promise<DataFeedResult>;
  refreshAll: () => Promise<DataUpdateReport>;
};

export function buildLocalDataUpdateReport(
  snapshot: TournamentSnapshot = currentTournamentSnapshot
): DataUpdateReport {
  return {
    adapterId: snapshotAdapter.id,
    adapterLabel: snapshotAdapter.label,
    generatedAt: snapshot.collectedAt,
    feeds: buildLocalFeedResults(snapshot),
    qualityChecks: validateTournamentSnapshot(snapshot)
  };
}

export const snapshotAdapter: TournamentDataAdapter = {
  id: "verified-static-snapshot",
  label: "官方/媒体核验静态快照",
  provider: {
    id: "verified-static-snapshot",
    label: "本地核验快照",
    kind: "manual",
    url: "local://src/data/snapshot.ts",
    updatedAt: currentTournamentSnapshot.collectedAt,
    retrievedAt: currentTournamentSnapshot.collectedAt,
    coverage: "球队、分组、72 场小组赛、已完赛比分、来源元数据",
    status: "active",
    notes: "当前应用默认适配器；可被后端抓取适配器无缝替换。"
  },
  fetchSnapshot: async () => currentTournamentSnapshot,
  fetchFixtures: async () => buildLocalFeedResults(currentTournamentSnapshot)[0],
  fetchRankings: async () => buildLocalFeedResults(currentTournamentSnapshot)[1],
  fetchInjuries: async () => buildLocalFeedResults(currentTournamentSnapshot)[2],
  fetchOdds: async () => buildLocalFeedResults(currentTournamentSnapshot)[3],
  fetchRecentForm: async () => buildLocalFeedResults(currentTournamentSnapshot)[4],
  fetchNews: async () => buildLocalFeedResults(currentTournamentSnapshot)[5],
  refreshAll: async () => buildLocalDataUpdateReport(currentTournamentSnapshot)
};

export const plannedAdapters: TournamentDataAdapter[] = dataProviders.map((provider) => ({
  id: `${provider.id}-adapter`,
  label: `${provider.label} 适配器`,
  provider: {
    ...provider,
    status: provider.status === "active" ? "planned" : provider.status
  },
  fetchSnapshot: async () => {
    throw new Error(`${provider.label} 需要后端代理或授权抓取任务后才能在浏览器中直接执行。`);
  },
  fetchFixtures: async () => buildBlockedFeed(provider, "fixtures"),
  fetchRankings: async () => buildBlockedFeed(provider, "rankings"),
  fetchInjuries: async () => buildBlockedFeed(provider, "injuries"),
  fetchOdds: async () => buildBlockedFeed(provider, "odds"),
  fetchRecentForm: async () => buildBlockedFeed(provider, "recentForm"),
  fetchNews: async () => buildBlockedFeed(provider, "news"),
  refreshAll: async () => ({
    adapterId: `${provider.id}-adapter`,
    adapterLabel: `${provider.label} 适配器`,
    generatedAt: provider.retrievedAt,
    feeds: [
      buildBlockedFeed(provider, "fixtures"),
      buildBlockedFeed(provider, "rankings"),
      buildBlockedFeed(provider, "injuries"),
      buildBlockedFeed(provider, "odds"),
      buildBlockedFeed(provider, "recentForm"),
      buildBlockedFeed(provider, "news")
    ],
    qualityChecks: validateTournamentSnapshot(currentTournamentSnapshot)
  })
}));

export const tournamentDataAdapters: TournamentDataAdapter[] = [
  snapshotAdapter,
  ...plannedAdapters
];

export const adapterRoadmap = tournamentDataAdapters.map((adapter) => adapter.label);

function buildLocalFeedResults(snapshot: TournamentSnapshot): DataFeedResult[] {
  const rankingSource = snapshot.sources.find((source) => source.id === "fifa-ranking");
  const fixtureSource = snapshot.sources.find((source) => source.id === "fifa-fixtures");

  return [
    {
      id: "fixtures-local",
      label: "赛程/赛果",
      kind: "fixtures",
      status: "ready",
      records: snapshot.fixtures.length,
      updatedAt: fixtureSource?.updatedAt ?? snapshot.collectedAt,
      confidence: "verified",
      sourceId: fixtureSource?.id,
      message: `${snapshot.completedMatches} 场完赛，${snapshot.scheduledMatches} 场待赛。`
    },
    {
      id: "rankings-local",
      label: "FIFA 排名",
      kind: "rankings",
      status: "ready",
      records: snapshot.teams.length,
      updatedAt: rankingSource?.updatedAt ?? snapshot.collectedAt,
      confidence: "verified",
      sourceId: rankingSource?.id,
      message: "排名字段已进入球队基础评分。"
    },
    {
      id: "injuries-placeholder",
      label: "伤停负荷",
      kind: "injuries",
      status: "placeholder",
      records: snapshot.teams.length,
      updatedAt: snapshot.collectedAt,
      confidence: "estimated",
      message: "当前使用球队级占位伤停值；可通过 injuries-news 或 news-sentiment 脚本导入。"
    },
    {
      id: "odds-planned",
      label: "赔率市场",
      kind: "odds",
      status: "planned",
      records: 0,
      updatedAt: snapshot.collectedAt,
      confidence: "seed",
      message: "已预留接口，后续接入授权赔率 API 或手工导入。"
    },
    {
      id: "recent-form-placeholder",
      label: "近期战绩",
      kind: "recentForm",
      status: "placeholder",
      records: snapshot.teams.length,
      updatedAt: snapshot.collectedAt,
      confidence: "estimated",
      message: "当前使用球队级状态占位值；可通过 recent-form 脚本导入最近 5-10 场比赛。"
    },
    {
      id: "news-planned",
      label: "新闻/舆情",
      kind: "news",
      status: "planned",
      records: 0,
      updatedAt: snapshot.collectedAt,
      confidence: "seed",
      message: "已预留接口；可通过 news-sentiment 脚本导入新闻情绪和舆情风险。"
    }
  ];
}

function buildBlockedFeed(
  provider: DataProvider,
  kind: DataFeedResult["kind"]
): DataFeedResult {
  return {
    id: `${provider.id}-${kind}-blocked`,
    label: provider.label,
    kind,
    status: "blocked",
    records: 0,
    updatedAt: provider.retrievedAt,
    confidence: "seed",
    sourceId: provider.id,
    message: "浏览器端不直接联网抓取；需要后端代理、定时任务或手工导入。"
  };
}
