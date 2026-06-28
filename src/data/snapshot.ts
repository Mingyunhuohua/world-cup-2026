import type { TournamentSnapshot } from "../types.ts";
import { fixtures } from "./fixtures.ts";
import { dataProviders, snapshotCollectedAt } from "./sources.ts";
import { teams } from "./teams.ts";
import { buildKnockoutFixtures } from "../model/knockoutFixtures.ts";

// 小组赛全部完赛后，用真实排名 + FIFA 官方对位规则自动推导 32 强及后续轮次对阵，
// 让现有单场预测通道自然覆盖淘汰赛。小组赛未完赛时返回空数组，不影响现有行为。
const knockoutFixtures = buildKnockoutFixtures(fixtures, teams);
const allFixtures = [...fixtures, ...knockoutFixtures];

const completedMatches = allFixtures.filter((match) => match.status === "completed").length;

export const currentTournamentSnapshot: TournamentSnapshot = {
  id: "world-cup-2026-verified-snapshot-2026-06-21-cn",
  label: "2026 世界杯官方/核验数据快照",
  collectedAt: snapshotCollectedAt,
  teams,
  fixtures: allFixtures,
  sources: dataProviders,
  completedMatches,
  scheduledMatches: allFixtures.length - completedMatches,
  notes: [
    "FIFA 官方赛程页作为主来源，因公开页面为前端渲染，当前版本使用截至 2026-06-21 的手工核验快照驱动前端。",
    "FIFA 男足排名官方更新时间为 2026-06-11；ELO、攻防、状态、伤停仍为模型输入占位。",
    "已完赛比分会直接进入小组积分和蒙特卡洛模拟，未完赛比赛继续用泊松模型抽样。",
    "淘汰赛对阵由真实小组排名按 FIFA 官方 32 强对位规则自动推导，并在上一轮完赛后逐轮生成。"
  ]
};
