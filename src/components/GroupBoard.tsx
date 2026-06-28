import { calculateGroupDifficulty } from "../model/groupDifficulty.ts";
import { groupTieBreakerSteps } from "../model/standings.ts";
import type { GroupStanding, Team, TeamSimulationSummary } from "../types.ts";
import { percent } from "../utils/format.ts";

type GroupBoardProps = {
  standings: GroupStanding[];
  simulationByTeamId: Map<string, TeamSimulationSummary>;
  teamsById: Map<string, Team>;
  activeGroup: string;
  onGroupChange: (group: string) => void;
};

const KNOCKOUT_LABEL = "淘汰赛";

export function GroupBoard({
  standings,
  simulationByTeamId,
  teamsById,
  activeGroup,
  onGroupChange
}: GroupBoardProps) {
  const groups = "ABCDEFGHIJKL".split("");
  const isKnockout = activeGroup === KNOCKOUT_LABEL;
  const activeStandings = standings.filter((standing) => standing.group === activeGroup);
  const visibleStandings = activeStandings.filter((standing) => teamsById.has(standing.teamId));
  const visibleTeams = visibleStandings
    .map((standing) => teamsById.get(standing.teamId))
    .filter((team): team is Team => Boolean(team));
  const activeSimulations = visibleStandings
    .map((standing) => simulationByTeamId.get(standing.teamId))
    .filter((summary): summary is TeamSimulationSummary => Boolean(summary));
  const difficulty = calculateGroupDifficulty(activeGroup, visibleTeams, activeSimulations);
  const implementedTieBreakers = groupTieBreakerSteps
    .filter((step) => step.status === "implemented")
    .map((step) => step.label)
    .join(" / ");
  const placeholderTieBreakers = groupTieBreakerSteps
    .filter((step) => step.status === "placeholder")
    .map((step) => step.label)
    .join(" / ");

  return (
    <section className="panel group-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">小组形势</span>
          <h2>{isKnockout ? "淘汰赛阶段" : `${activeGroup} 组`}</h2>
        </div>
        <div aria-label="选择小组" className="segmented">
          {groups.map((group) => (
            <button
              aria-pressed={group === activeGroup}
              className={group === activeGroup ? "is-active" : ""}
              key={group}
              onClick={() => onGroupChange(group)}
              type="button"
            >
              {group}
            </button>
          ))}
          <button
            aria-pressed={isKnockout}
            className={isKnockout ? "is-active" : ""}
            key={KNOCKOUT_LABEL}
            onClick={() => onGroupChange(KNOCKOUT_LABEL)}
            type="button"
          >
            淘汰赛
          </button>
        </div>
      </div>

      {isKnockout ? (
        <p className="panel-empty">
          小组赛已结束，32 强及后续轮次对阵见下方"赛程"面板。每轮上一轮完赛后自动生成下一轮对阵，单场预测与小组赛一致。
        </p>
      ) : (
        <>
          <div className={`group-difficulty group-difficulty--${difficulty.level}`}>
            <div>
              <span>小组难度</span>
              <strong>{difficulty.label}</strong>
            </div>
            <div>
              <span>指数</span>
              <strong>{difficulty.score}</strong>
            </div>
            <div>
              <span>平均 ELO</span>
              <strong>{difficulty.averageElo}</strong>
            </div>
            <div>
              <span>平均排名</span>
              <strong>{difficulty.averageFifaRank}</strong>
            </div>
          </div>

          <div className="standings">
            <div className="standings__row standings__row--head">
              <span>队伍</span>
              <span>预期分</span>
              <span>净胜</span>
              <span>出线</span>
            </div>
            {visibleStandings.map((standing, index) => {
              const team = teamsById.get(standing.teamId);
              const simulation = simulationByTeamId.get(standing.teamId);
              const qualificationProbability =
                simulation?.groupQualification ?? simulation?.round32 ?? 0;
              if (!team) {
                return null;
              }

              return (
                <div className="standings__row" key={standing.teamId}>
                  <span>
                    <b>{index + 1}</b>
                    <i style={{ backgroundColor: team.color }} />
                    {team.name}
                  </span>
                  <strong>{standing.points.toFixed(1)}</strong>
                  <span>
                    {standing.goalDifference > 0 ? "+" : ""}
                    {standing.goalDifference.toFixed(1)}
                  </span>
                  <span className="standings-qualification">
                    <strong>{percent(qualificationProbability, 0)}</strong>
                    <em style={{ width: `${Math.max(3, qualificationProbability * 100)}%` }} />
                  </span>
                </div>
              );
            })}
            {visibleStandings.length === 0 ? (
              <p className="panel-empty">当前小组暂无可展示球队。</p>
            ) : null}
          </div>
          <p className="tie-break-note">
            同分排序：{implementedTieBreakers}。未实接：{placeholderTieBreakers}。
          </p>
        </>
      )}
    </section>
  );
}
