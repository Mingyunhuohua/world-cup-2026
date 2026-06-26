import { useMemo } from "react";
import type { TournamentSnapshot } from "../types.ts";

type TournamentProgressProps = {
  snapshot: TournamentSnapshot;
};

const DONUT_RADIUS = 42;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export function TournamentProgress({ snapshot }: TournamentProgressProps) {
  const stats = useMemo(() => {
    const groups = new Map<string, { done: number; total: number }>();
    let groupDone = 0;
    let groupTotal = 0;

    for (const fixture of snapshot.fixtures) {
      if (!fixture.group) {
        continue;
      }
      const entry = groups.get(fixture.group) ?? { done: 0, total: 0 };
      entry.total += 1;
      groupTotal += 1;
      if (fixture.status === "completed" && fixture.result) {
        entry.done += 1;
        groupDone += 1;
      }
      groups.set(fixture.group, entry);
    }

    const sortedGroups = [...groups.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    );
    const percent = groupTotal > 0 ? Math.round((groupDone / groupTotal) * 100) : 0;

    return { sortedGroups, groupDone, groupTotal, percent };
  }, [snapshot.fixtures]);

  const dash = (stats.percent / 100) * DONUT_CIRCUMFERENCE;
  const teamCount = snapshot.teams.length;

  return (
    <section className="panel tournament-progress-panel" aria-label="赛事数据接入概览">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">数据接入概览</span>
          <h2>赛事完整度</h2>
        </div>
        <span className="table-meta">随官方赛果自动更新</span>
      </div>

      <div className="tp-overview">
        <svg className="tp-donut" viewBox="0 0 110 110" role="img" aria-label={`小组赛已完赛 ${stats.percent}%，共 ${stats.groupDone} / ${stats.groupTotal} 场`}>
          <circle className="tp-donut__track" cx="55" cy="55" r={DONUT_RADIUS} />
          <circle
            className="tp-donut__value"
            cx="55"
            cy="55"
            r={DONUT_RADIUS}
            strokeDasharray={`${dash} ${DONUT_CIRCUMFERENCE - dash}`}
            transform="rotate(-90 55 55)"
          />
          <text className="tp-donut__percent" x="55" y="52" textAnchor="middle">
            {stats.percent}%
          </text>
          <text className="tp-donut__caption" x="55" y="69" textAnchor="middle">
            小组赛完赛
          </text>
        </svg>
        <div className="tp-metrics">
          <div className="tp-metric">
            <span>已完赛 / 总场次</span>
            <strong>
              {stats.groupDone} <em>/ {stats.groupTotal}</em>
            </strong>
          </div>
          <div className="tp-metric">
            <span>淘汰赛</span>
            <strong>{stats.groupDone >= stats.groupTotal && stats.groupTotal > 0 ? "可生成对阵" : "待开始"}</strong>
          </div>
          <div className="tp-metric">
            <span>已接入球队</span>
            <strong>
              {teamCount} <em>/ {teamCount}</em>
            </strong>
          </div>
          <div className="tp-metric">
            <span>赛果数据来源</span>
            <strong className="tp-metric__source">The Odds API · 实时</strong>
          </div>
        </div>
      </div>

      <div className="tp-groups">
        {stats.sortedGroups.map(([group, entry]) => {
          const groupPercent = entry.total > 0 ? Math.round((entry.done / entry.total) * 100) : 0;
          const complete = entry.done >= entry.total && entry.total > 0;
          return (
            <div className="tp-group-row" key={group}>
              <span className="tp-group-row__label">{group}</span>
              <span className="tp-group-row__track">
                <b className={complete ? "is-complete" : ""} style={{ width: `${Math.max(groupPercent, 3)}%` }} />
              </span>
              <span className="tp-group-row__value">{entry.done}/{entry.total}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
