import { useMemo } from "react";
import type { Match, Team } from "../types.ts";
import { formatDateTime } from "../utils/format.ts";

type LatestResultsWallProps = {
  fixtures: Match[];
  teamsById: Map<string, Team>;
  limit?: number;
};

function resultTime(match: Match): number {
  const parsed = Date.parse(match.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function LatestResultsWall({ fixtures, teamsById, limit = 8 }: LatestResultsWallProps) {
  const recent = useMemo(
    () =>
      fixtures
        .filter((match) => match.status === "completed" && match.result)
        .sort((left, right) => resultTime(right) - resultTime(left))
        .slice(0, limit),
    [fixtures, limit]
  );

  if (recent.length === 0) {
    return null;
  }

  return (
    <section className="panel results-wall-panel" aria-label="最新完赛比分">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">最新战报</span>
          <h2>最近完赛的真实比分</h2>
        </div>
        <span className="table-meta">按开赛时间倒序 · 随官方赛果自动更新</span>
      </div>
      <div className="results-wall">
        {recent.map((match) => {
          const home = teamsById.get(match.homeTeamId);
          const away = teamsById.get(match.awayTeamId);
          const result = match.result;
          if (!home || !away || !result) {
            return null;
          }

          const homeWin = result.homeGoals > result.awayGoals;
          const awayWin = result.awayGoals > result.homeGoals;
          const draw = !homeWin && !awayWin;
          const dateLabel = Number.isFinite(Date.parse(match.date))
            ? formatDateTime(match.date)
            : "时间待定";

          return (
            <article className="result-card" key={match.id}>
              <span className="result-card__meta">
                <span>MD {match.matchday ?? "-"} · {dateLabel}</span>
                <em className={draw ? "is-draw" : ""}>{draw ? "平局" : "已完赛"}</em>
              </span>
              <span className="result-card__teams">
                <span className={awayWin ? "is-faded" : ""}>
                  <i style={{ backgroundColor: home.color }} />
                  {home.abbr}
                </span>
                <strong className="result-card__score">
                  <b className={homeWin ? "is-win" : draw ? "is-draw" : "is-loss"}>
                    {result.homeGoals}
                  </b>
                  <span>-</span>
                  <b className={awayWin ? "is-win" : draw ? "is-draw" : "is-loss"}>
                    {result.awayGoals}
                  </b>
                </strong>
                <span className={`is-right ${homeWin ? "is-faded" : ""}`}>
                  {away.abbr}
                  <i style={{ backgroundColor: away.color }} />
                </span>
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
