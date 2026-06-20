import type { Match, ModelConfig, Team } from "../types.ts";

export type ParameterInsight = {
  label: string;
  value: number;
  direction: string;
  description: string;
};

export function buildParameterInsights(
  match: Match,
  teamsById: Map<string, Team>,
  config: ModelConfig
): ParameterInsight[] {
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);

  if (!home || !away) {
    return [];
  }

  const insights: ParameterInsight[] = [
    {
      label: "ELO 权重",
      value: Math.abs(home.elo - away.elo) * config.eloWeight,
      direction: home.elo >= away.elo ? `偏向 ${home.abbr}` : `偏向 ${away.abbr}`,
      description: "权重越高，基础评级差距越能拉开胜率。"
    },
    {
      label: "FIFA 排名权重",
      value: Math.abs(home.fifaRank - away.fifaRank) * config.rankWeight,
      direction: home.fifaRank <= away.fifaRank ? `偏向 ${home.abbr}` : `偏向 ${away.abbr}`,
      description: "权重越高，排名更高的球队会获得更强先验。"
    },
    {
      label: "近期状态权重",
      value: Math.abs(home.form - away.form) * config.formWeight * 100,
      direction: home.form >= away.form ? `偏向 ${home.abbr}` : `偏向 ${away.abbr}`,
      description: "权重越高，近期状态差异会更明显改变预期进球。"
    },
    {
      label: "伤停权重",
      value: Math.abs(home.injuries - away.injuries) * config.injuryWeight * 100,
      direction: home.injuries <= away.injuries ? `偏向 ${home.abbr}` : `偏向 ${away.abbr}`,
      description: "权重越高，伤停负荷较大的球队被惩罚越明显。"
    },
    {
      label: "东道主修正",
      value: (home.host || away.host ? config.hostBoost : 0) * 100,
      direction: home.host ? `偏向 ${home.abbr}` : away.host ? `偏向 ${away.abbr}` : "中立",
      description: "东道主修正会改变比赛双方的基础进球期望。"
    },
    {
      label: "低比分修正",
      value: Math.abs(config.dixonColesRho) * 100,
      direction: config.dixonColesRho < 0 ? "强化常见小比分" : "弱化小比分修正",
      description: "Dixon-Coles 参数主要影响 0-0、1-0、0-1、1-1。"
    }
  ];

  return insights
    .filter((insight) => insight.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}
