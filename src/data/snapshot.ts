import type { TournamentSnapshot } from "../types.ts";
import { fixtures } from "./fixtures.ts";
import { dataProviders, snapshotCollectedAt } from "./sources.ts";
import { teams } from "./teams.ts";

const completedMatches = fixtures.filter((match) => match.status === "completed").length;

export const currentTournamentSnapshot: TournamentSnapshot = {
  id: "world-cup-2026-verified-snapshot-2026-06-21-cn",
  label: "2026 世界杯官方/核验数据快照",
  collectedAt: snapshotCollectedAt,
  teams,
  fixtures,
  sources: dataProviders,
  completedMatches,
  scheduledMatches: fixtures.length - completedMatches,
  notes: [
    "FIFA 官方赛程页作为主来源，因公开页面为前端渲染，当前版本使用截至 2026-06-21 的手工核验快照驱动前端。",
    "FIFA 男足排名官方更新时间为 2026-06-11；ELO、攻防、状态、伤停仍为模型输入占位。",
    "已完赛比分会直接进入小组积分和蒙特卡洛模拟，未完赛比赛继续用泊松模型抽样。"
  ]
};
