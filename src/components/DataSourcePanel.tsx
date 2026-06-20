import { useMemo } from "react";
import type { TournamentSnapshot } from "../types.ts";
import { formatDateTime } from "../utils/format.ts";
import { Icon } from "./Icon.tsx";

type DataSourcePanelProps = {
  snapshot: TournamentSnapshot;
};

export function DataSourcePanel({ snapshot }: DataSourcePanelProps) {
  const teamsById = useMemo(
    () => new Map(snapshot.teams.map((team) => [team.id, team])),
    [snapshot.teams]
  );
  const latestCompleted = useMemo(
    () =>
      snapshot.fixtures
        .filter((match) => match.status === "completed" && match.result)
        .sort((left, right) => compareFixtureDates(right.date, left.date))
        .slice(0, 5),
    [snapshot.fixtures]
  );
  const nextPending = useMemo(
    () =>
      snapshot.fixtures
        .filter((match) => match.status !== "completed")
        .sort((left, right) => compareFixtureDates(left.date, right.date))
        .slice(0, 4),
    [snapshot.fixtures]
  );

  return (
    <section className="panel source-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">数据快照</span>
          <h2>来源与覆盖</h2>
        </div>
      </div>

      <div className="source-summary">
        <div>
          <strong>{snapshot.completedMatches}</strong>
          <span>已完赛</span>
        </div>
        <div>
          <strong>{snapshot.scheduledMatches}</strong>
          <span>未完赛</span>
        </div>
        <div>
          <strong>{formatDateTime(snapshot.collectedAt)}</strong>
          <span>采集时间</span>
        </div>
      </div>

      <div className="source-ledger" aria-label="快照赛果摘要">
        <div className="source-ledger__section">
          <div className="source-ledger__title">
            <strong>最新已入模比分</strong>
            <span>{latestCompleted.length} 场</span>
          </div>
          <div className="source-ledger__list">
            {latestCompleted.map((match) => {
              const home = teamsById.get(match.homeTeamId);
              const away = teamsById.get(match.awayTeamId);

              return (
                <article className="source-ledger__item" key={match.id}>
                  <div>
                    <strong>
                      {home?.abbr ?? match.homeTeamId} {match.result?.homeGoals ?? "-"}-
                      {match.result?.awayGoals ?? "-"} {away?.abbr ?? match.awayTeamId}
                    </strong>
                    <span>
                      {match.group} 组 · MD {match.matchday ?? "-"} · {formatDateTime(match.date)}
                    </span>
                  </div>
                  <em>已计入</em>
                </article>
              );
            })}
          </div>
        </div>

        <div className="source-ledger__section">
          <div className="source-ledger__title">
            <strong>下一批待更新</strong>
            <span>{nextPending.length} 场</span>
          </div>
          <div className="source-ledger__list">
            {nextPending.map((match) => {
              const home = teamsById.get(match.homeTeamId);
              const away = teamsById.get(match.awayTeamId);

              return (
                <article className="source-ledger__item source-ledger__item--pending" key={match.id}>
                  <div>
                    <strong>
                      {home?.abbr ?? match.homeTeamId} vs {away?.abbr ?? match.awayTeamId}
                    </strong>
                    <span>
                      {match.group} 组 · MD {match.matchday ?? "-"} · {formatDateTime(match.date)}
                    </span>
                  </div>
                  <em>待赛</em>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div className="source-list">
        {snapshot.sources.slice(0, 3).map((source) => (
          <a href={source.url} key={source.id} rel="noreferrer" target="_blank">
            <span className={`source-kind source-kind--${source.kind}`}>
              <Icon name={source.kind === "official" ? "shield" : "database"} size={14} />
            </span>
            <div>
              <strong>{source.label}</strong>
              <p>{source.coverage}</p>
            </div>
            <em>{source.status === "active" ? "启用" : "兜底"}</em>
          </a>
        ))}
      </div>
    </section>
  );
}

function compareFixtureDates(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return 0;
  }

  if (!Number.isFinite(leftTime)) {
    return 1;
  }

  if (!Number.isFinite(rightTime)) {
    return -1;
  }

  return leftTime - rightTime;
}
