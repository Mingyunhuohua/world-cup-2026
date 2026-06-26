import { useMemo } from "react";
import type { SimulationSummary, Team } from "../types.ts";
import { percent } from "../utils/format.ts";

type ChampionRaceProps = {
  simulation: SimulationSummary;
  teamsById: Map<string, Team>;
  limit?: number;
};

export function ChampionRace({ simulation, teamsById, limit = 6 }: ChampionRaceProps) {
  const contenders = useMemo(
    () =>
      simulation.teams
        .filter((summary) => teamsById.has(summary.teamId))
        .slice()
        .sort((left, right) => right.champion - left.champion)
        .slice(0, limit),
    [simulation.teams, teamsById, limit]
  );

  const max = contenders[0]?.champion ?? 0;

  return (
    <div className="champion-race">
      <span className="champion-race__title">冠军争夺 · 实时模拟</span>
      <div className="champion-race__rows">
        {contenders.map((summary, index) => {
          const team = teamsById.get(summary.teamId);
          if (!team) {
            return null;
          }
          const width = max > 0 ? Math.max(6, (summary.champion / max) * 100) : 6;

          return (
            <div className="champion-row" key={summary.teamId}>
              <span className="champion-row__team">
                <i style={{ backgroundColor: team.color }} />
                {team.abbr}
              </span>
              <span className="champion-row__track">
                <b
                  className={index === 0 ? "is-leader" : ""}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="champion-row__value">{percent(summary.champion, 1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
