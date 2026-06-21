import { useMemo } from "react";
import { activeKnockoutRuleSet } from "../model/tournamentRules.ts";
import type { SimulationSummary, Team, TeamSimulationSummary } from "../types.ts";
import { percent } from "../utils/format.ts";

type BracketPreviewProps = {
  simulation: SimulationSummary;
  teamsById: Map<string, Team>;
};

type BracketRound = {
  key: keyof Pick<
    TeamSimulationSummary,
    "round32" | "round16" | "quarterFinal" | "semiFinal" | "final" | "champion"
  >;
  label: string;
  limit: number;
};

type KnockoutInsight = {
  label: string;
  value: string;
  detail: string;
  tone: "green" | "blue" | "orange";
};

const rounds: BracketRound[] = [
  { key: "round32", label: "32强", limit: 4 },
  { key: "round16", label: "16强", limit: 4 },
  { key: "quarterFinal", label: "8强", limit: 3 },
  { key: "semiFinal", label: "4强", limit: 3 },
  { key: "final", label: "决赛", limit: 2 },
  { key: "champion", label: "冠军", limit: 1 }
];

function getTopTeams(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>,
  key: BracketRound["key"],
  limit: number
) {
  return simulation.teams
    .filter((summary) => teamsById.has(summary.teamId))
    .sort((left, right) => right[key] - left[key])
    .slice(0, limit);
}

function getPathDifficulty(summary: TeamSimulationSummary) {
  if (summary.round32 <= 0) {
    return 0;
  }

  const titleConversion = summary.champion / summary.round32;
  return 1 - titleConversion;
}

function buildKnockoutInsights(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>
): KnockoutInsight[] {
  const championLeaders = getTopTeams(simulation, teamsById, "champion", 2);
  const finalLeaders = getTopTeams(simulation, teamsById, "final", 2);
  const topChampion = championLeaders[0];
  const runner = championLeaders[1];
  const topFinalist = finalLeaders[0];
  const topChampionTeam = topChampion ? teamsById.get(topChampion.teamId) : undefined;
  const runnerTeam = runner ? teamsById.get(runner.teamId) : undefined;
  const topFinalistTeam = topFinalist ? teamsById.get(topFinalist.teamId) : undefined;
  const hardestPath = simulation.teams
    .filter((summary) => teamsById.has(summary.teamId) && summary.round32 >= 0.2)
    .sort((left, right) => getPathDifficulty(right) - getPathDifficulty(left))[0];
  const hardestPathTeam = hardestPath ? teamsById.get(hardestPath.teamId) : undefined;

  return [
    {
      label: "冠军热门",
      value: topChampionTeam ? topChampionTeam.abbr : "暂无",
      detail: topChampion
        ? `${percent(topChampion.champion, 1)} 夺冠概率${runnerTeam ? `，领先 ${runnerTeam.abbr}` : ""}`
        : "等待模拟完成",
      tone: "green"
    },
    {
      label: "决赛席位",
      value: topFinalistTeam ? topFinalistTeam.abbr : "暂无",
      detail: topFinalist
        ? `${percent(topFinalist.final, 1)} 进入决赛，半区稳定性最高`
        : "等待模拟完成",
      tone: "blue"
    },
    {
      label: "路径压力",
      value: hardestPathTeam ? hardestPathTeam.abbr : "暂无",
      detail: hardestPath
        ? `晋级32强后夺冠转化率 ${percent(hardestPath.champion / Math.max(hardestPath.round32, 0.001), 1)}`
        : "暂无足够样本",
      tone: "orange"
    }
  ];
}

export function BracketPreview({ simulation, teamsById }: BracketPreviewProps) {
  const columns = useMemo(
    () =>
      rounds.map((round) => ({
        ...round,
        teams: getTopTeams(simulation, teamsById, round.key, round.limit)
      })),
    [simulation.teams, teamsById]
  );
  const insights = useMemo(
    () => buildKnockoutInsights(simulation, teamsById),
    [simulation, teamsById]
  );
  const championContenders = useMemo(
    () => getTopTeams(simulation, teamsById, "champion", 6),
    [simulation, teamsById]
  );
  const finalContenders = useMemo(
    () => getTopTeams(simulation, teamsById, "final", 6),
    [simulation, teamsById]
  );
  const hasVisibleTeams = columns.some((column) => column.teams.length > 0);

  return (
    <section className="panel bracket-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">淘汰赛</span>
          <h2>晋级路径树</h2>
        </div>
        <span className={`rule-badge rule-badge--${activeKnockoutRuleSet.source}`}>
          {activeKnockoutRuleSet.source === "official" ? "官方规则" : "占位规则"}
        </span>
      </div>

      <div className="knockout-insights" aria-label="淘汰赛路径摘要">
        {insights.map((insight) => (
          <div className={`knockout-insight knockout-insight--${insight.tone}`} key={insight.label}>
            <span>{insight.label}</span>
            <strong>{insight.value}</strong>
            <p>{insight.detail}</p>
          </div>
        ))}
      </div>

      <div className="knockout-contenders" aria-label="淘汰赛热门候选">
        <ContenderList
          label="冠军候选"
          summaries={championContenders}
          teamsById={teamsById}
          valueKey="champion"
        />
        <ContenderList
          label="决赛候选"
          summaries={finalContenders}
          teamsById={teamsById}
          valueKey="final"
        />
      </div>

      {hasVisibleTeams ? (
        <div className="bracket-tree" aria-label="各轮晋级路径概率">
          {columns.map((column) => (
            <div className="bracket-tree__round" key={column.key}>
              <div className="bracket-tree__round-header">
                <span>{column.label}</span>
                <em>Top {column.teams.length}</em>
              </div>
              <div className="bracket-tree__slots">
                {column.teams.map((summary, index) => {
                  const team = teamsById.get(summary.teamId);
                  if (!team) {
                    return null;
                  }
                  const probability = summary[column.key];

                  return (
                    <article
                      className={column.key === "champion" ? "bracket-tree__slot is-champion" : "bracket-tree__slot"}
                      key={`${column.key}-${summary.teamId}`}
                    >
                      <span className="bracket-tree__seed">{index + 1}</span>
                      <div className="bracket-tree__team">
                        <i style={{ backgroundColor: team.color }} />
                        <div>
                          <strong>{team.abbr}</strong>
                          <span>{team.group} 组 · {team.name}</span>
                        </div>
                      </div>
                      <div className="bracket-tree__probability">
                        <strong>{percent(probability, column.key === "round32" ? 0 : 1)}</strong>
                        <b style={{ width: `${Math.max(3, probability * 100)}%` }} />
                        {column.key === "champion" ? (
                          <small>
                            95% {percent(summary.championCiLow, 1)}-{percent(summary.championCiHigh, 1)}
                          </small>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel-empty">暂无可展示的淘汰赛路径。</p>
      )}
      <p className="note">
        当前使用 {activeKnockoutRuleSet.label}。该视图按各轮晋级概率生成路径树；
        {activeKnockoutRuleSet.source === "official"
          ? "32 强对位遵循官方赛程编号与晋级路径，最佳第三名顶替哪个对位槛位按官方资格范围用稳定匹配算法求解。"
          : "官方最佳第三名对位规则接入后可替换。"}
      </p>
    </section>
  );
}

function ContenderList({
  label,
  summaries,
  teamsById,
  valueKey
}: {
  label: string;
  summaries: TeamSimulationSummary[];
  teamsById: Map<string, Team>;
  valueKey: "champion" | "final";
}) {
  const maxProbability = Math.max(...summaries.map((summary) => summary[valueKey]), 0.001);

  return (
    <div className="contender-list">
      <div className="contender-list__header">
        <strong>{label}</strong>
        <span>Top {summaries.length}</span>
      </div>
      <div className="contender-list__rows">
        {summaries.map((summary) => {
          const team = teamsById.get(summary.teamId);
          if (!team) {
            return null;
          }
          const probability = summary[valueKey];

          return (
            <div className="contender-row" key={`${valueKey}-${summary.teamId}`}>
              <span className="contender-row__team">
                <i style={{ backgroundColor: team.color }} />
                <strong>{team.abbr}</strong>
                <em>{team.group}组</em>
              </span>
              <span className="contender-row__track">
                <b style={{ width: `${Math.max(4, (probability / maxProbability) * 100)}%` }} />
              </span>
              <span className="contender-row__probability">{percent(probability, 1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
