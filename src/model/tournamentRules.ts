import type { GroupStanding } from "../types.ts";

export type QualifiedTeam = {
  teamId: string;
  group: string;
  rank: number;
  standing: GroupStanding;
};

export type RoundOf32QualifiedTeams = {
  firsts: QualifiedTeam[];
  seconds: QualifiedTeam[];
  bestThirds: QualifiedTeam[];
};

export type RoundOf32Pair = [QualifiedTeam, QualifiedTeam];

export type KnockoutRuleSet = {
  id: string;
  label: string;
  source: "official" | "placeholder";
  notes: string;
  buildRoundOf32Pairs: (qualified: RoundOf32QualifiedTeams) => RoundOf32Pair[];
};

function buildMvpSeededRoundOf32Pairs(
  qualified: RoundOf32QualifiedTeams
): RoundOf32Pair[] {
  const { firsts, seconds, bestThirds } = qualified;
  const getFirst = (index: number) => firsts[index % firsts.length];
  const getSecond = (index: number) => seconds[index % seconds.length];
  const getThird = (index: number) => bestThirds[index % bestThirds.length];

  return [
    [getFirst(0), getThird(7)],
    [getFirst(1), getThird(6)],
    [getFirst(2), getThird(5)],
    [getFirst(3), getThird(4)],
    [getFirst(4), getThird(3)],
    [getFirst(5), getThird(2)],
    [getFirst(6), getThird(1)],
    [getFirst(7), getThird(0)],
    [getFirst(8), getSecond(11)],
    [getFirst(9), getSecond(10)],
    [getFirst(10), getSecond(9)],
    [getFirst(11), getSecond(8)],
    [getSecond(0), getSecond(1)],
    [getSecond(2), getSecond(3)],
    [getSecond(4), getSecond(5)],
    [getSecond(6), getSecond(7)]
  ].filter((pair): pair is RoundOf32Pair => Boolean(pair[0] && pair[1]));
}

export const mvpSeededKnockoutRuleSet: KnockoutRuleSet = {
  id: "mvp-seeded-2026-placeholder",
  label: "MVP 种子占位对位",
  source: "placeholder",
  notes:
    "按小组第一、第二和最佳第三名构造稳定 32 强对位。该规则用于模拟闭环，不代表 FIFA 官方 2026 淘汰赛对位映射。",
  buildRoundOf32Pairs: buildMvpSeededRoundOf32Pairs
};

export const activeKnockoutRuleSet = mvpSeededKnockoutRuleSet;

export function buildRoundOf32Pairs(
  qualified: RoundOf32QualifiedTeams,
  ruleSet: KnockoutRuleSet = activeKnockoutRuleSet
): RoundOf32Pair[] {
  return ruleSet.buildRoundOf32Pairs(qualified);
}
