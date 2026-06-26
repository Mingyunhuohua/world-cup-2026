import { useMemo } from "react";
import type { TournamentSnapshot } from "../types.ts";

type ScoringLeadersProps = {
  snapshot: TournamentSnapshot;
  limit?: number;
};

export function ScoringLeaders({ snapshot, limit = 6 }: ScoringLeadersProps) {
  const leaders = useMemo(() => {
    const goalsById = new Map<string, { goals: number; played: number }>();

    function add(teamId: string, goals: number) {
      const entry = goalsById.get(teamId) ?? { goals: 0, played: 0 };
      entry.goals += goals;
      entry.played += 1;
      goalsById.set(teamId, entry);
    }

    for (const fixture of snapshot.fixtures) {
      if (fixture.status !== "completed" || !fixture.result) {
        continue;
      }
      add(fixture.homeTeamId, fixture.result.homeGoals);
      add(fixture.awayTeamId, fixture.result.awayGoals);
    }

    return [...goalsById.entries()]
      .map(([teamId, entry]) => ({ teamId, ...entry }))
      .sort((left, right) => right.goals - left.goals || right.played - left.played)
      .slice(0, limit);
  }, [snapshot.fixtures, limit]);

  if (leaders.length === 0) {
    return null;
  }

  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
  const max = leaders[0]?.goals ?? 0;

  return (
    <section className="panel scoring-leaders-panel" aria-label="球队火力榜">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">真实数据洞察</span>
          <h2>球队火力榜</h2>
        </div>
        <span className="table-meta">真实赛果累计进球 · 自动更新</span>
      </div>
      <div className="scoring-leaders">
        {leaders.map((leader, index) => {
          const team = teamsById.get(leader.teamId);
          if (!team) {
            return null;
          }
          const width = max > 0 ? Math.max(8, (leader.goals / max) * 100) : 8;

          return (
            <div className="scoring-row" key={leader.teamId}>
              <span className="scoring-row__rank">{index + 1}</span>
              <span className="scoring-row__team">
                <i style={{ backgroundColor: team.color }} />
                {team.name}
              </span>
              <span className="scoring-row__track">
                <b className={index === 0 ? "is-top" : ""} style={{ width: `${width}%` }} />
              </span>
              <span className="scoring-row__value">
                {leader.goals}
                <em>球 / {leader.played} 场</em>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
