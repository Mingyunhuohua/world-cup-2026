import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GroupStanding,
  Match,
  ModelConfig,
  SimulationSummary,
  Team,
  TeamSimulationSummary,
  TournamentSnapshot
} from "../types.ts";
import { calculateActualGroupStandings } from "../model/standings.ts";
import { formatDateTime, percent } from "../utils/format.ts";
import {
  buildSimulationAuditSummary,
  buildSimulationExportFilename,
  buildSimulationShareFilename,
  serializeSimulationCsv,
  serializeSimulationJson,
  serializeSimulationShareSvg
} from "../utils/simulationExport.ts";
import { Icon } from "./Icon.tsx";

type SimulationTableProps = {
  modelConfig?: ModelConfig;
  simulation: SimulationSummary;
  snapshot?: TournamentSnapshot;
  teamsById: Map<string, Team>;
};

type SortKey =
  | "name"
  | "expectedPoints"
  | "round32"
  | "round16"
  | "quarterFinal"
  | "semiFinal"
  | "final"
  | "champion";

type SortDirection = "asc" | "desc";

const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "球队" },
  { key: "expectedPoints", label: "预期分" },
  { key: "round32", label: "32强" },
  { key: "round16", label: "16强" },
  { key: "quarterFinal", label: "8强" },
  { key: "semiFinal", label: "4强" },
  { key: "final", label: "决赛" },
  { key: "champion", label: "冠军" }
];

const pathStages: Array<{ key: keyof TeamSimulationSummary; label: string }> = [
  { key: "round32", label: "32" },
  { key: "round16", label: "16" },
  { key: "quarterFinal", label: "8" },
  { key: "semiFinal", label: "4" },
  { key: "final", label: "决" },
  { key: "champion", label: "冠" }
];

type TeamAnalysisTag = {
  label: string;
  detail: string;
  tone: "blue" | "green" | "orange" | "red";
};

type TeamDrawerContext = {
  actualStanding?: GroupStanding;
  groupRank?: number;
  remainingFixtures: Array<{
    fixture: Match;
    opponent: Team;
    opponentSummary?: TeamSimulationSummary;
    pressure: "high" | "low" | "medium";
    pressureLabel: string;
  }>;
  pathBreak: {
    from: string;
    to: string;
    drop: number;
  };
  riskNotes: Array<{
    label: string;
    detail: string;
    tone: "green" | "orange" | "red";
  }>;
};

export function SimulationTable({
  modelConfig,
  simulation,
  snapshot,
  teamsById
}: SimulationTableProps) {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("champion");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const groupOptions = useMemo(
    () => Array.from(new Set(simulation.teams.map((summary) => summary.group))).sort(),
    [simulation.teams]
  );

  const audit = useMemo(
    () => buildSimulationAuditSummary(simulation, { modelConfig, snapshot }),
    [modelConfig, simulation, snapshot]
  );
  const highlights = useMemo(
    () => buildSimulationHighlights(simulation, teamsById),
    [simulation, teamsById]
  );
  const analysisTagsByTeamId = useMemo(
    () => buildAnalysisTagsByTeamId(simulation),
    [simulation]
  );
  const drawerContextByTeamId = useMemo(
    () => buildTeamDrawerContexts(simulation, teamsById, snapshot),
    [simulation, snapshot, teamsById]
  );

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return simulation.teams
      .filter((summary) => {
        const team = teamsById.get(summary.teamId);
        if (!team) {
          return false;
        }

        const matchesGroup = groupFilter === "ALL" || summary.group === groupFilter;
        const matchesQuery =
          normalizedQuery.length === 0 ||
          team.name.toLowerCase().includes(normalizedQuery) ||
          team.abbr.toLowerCase().includes(normalizedQuery);

        return matchesGroup && matchesQuery;
      })
      .sort((left, right) => {
        const leftTeam = teamsById.get(left.teamId);
        const rightTeam = teamsById.get(right.teamId);
        const multiplier = sortDirection === "asc" ? 1 : -1;

        if (!leftTeam || !rightTeam) {
          return 0;
        }

        if (sortKey === "name") {
          return leftTeam.name.localeCompare(rightTeam.name, "zh-CN") * multiplier;
        }

        return (left[sortKey] - right[sortKey]) * multiplier;
      });
  }, [groupFilter, query, simulation.teams, sortDirection, sortKey, teamsById]);

  const selectedTeam = selectedTeamId ? teamsById.get(selectedTeamId) : undefined;
  const selectedSummary = selectedTeamId
    ? simulation.teams.find((summary) => summary.teamId === selectedTeamId)
    : undefined;
  const selectedDrawerContext = selectedTeamId
    ? drawerContextByTeamId.get(selectedTeamId)
    : undefined;

  useEffect(() => {
    if (!selectedTeamId) {
      return;
    }

    drawerCloseRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedTeamId(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedTeamId]);

  function changeSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  function renderSortButton(key: SortKey, label: string) {
    const isActive = sortKey === key;
    const directionMark = isActive ? (sortDirection === "asc" ? "↑" : "↓") : "";
    const directionLabel = sortDirection === "asc" ? "升序" : "降序";

    return (
      <button
        aria-label={isActive ? `按${label}排序，当前${directionLabel}` : `按${label}排序`}
        aria-pressed={isActive}
        className={isActive ? "table-sort-button is-active" : "table-sort-button"}
        onClick={() => changeSort(key)}
        type="button"
      >
        {label}
        <span>{directionMark}</span>
      </button>
    );
  }

  function getSortAria(column: SortKey) {
    if (sortKey !== column) {
      return undefined;
    }

    return sortDirection === "asc" ? "ascending" : "descending";
  }

  function exportSimulation(format: "csv" | "json") {
    const content =
      format === "csv"
        ? serializeSimulationCsv(simulation, teamsById)
        : serializeSimulationJson(simulation, teamsById, { modelConfig, snapshot });
    const blob = new Blob([content], {
      type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = buildSimulationExportFilename(simulation, format);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportShareCard() {
    const content = serializeSimulationShareSvg(simulation, teamsById, {
      modelConfig,
      snapshot
    });
    const blob = new Blob([content], {
      type: "image/svg+xml;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = buildSimulationShareFilename(simulation);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel table-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">模拟结果</span>
          <h2>晋级与夺冠概率</h2>
        </div>
        <span className="table-meta">{simulation.iterations.toLocaleString("zh-CN")} 次</span>
      </div>

      <SimulationHighlights highlights={highlights} />

      <div className="table-toolbar" aria-label="模拟结果筛选">
        <label className="table-search">
          <Icon name="search" size={15} />
          <input
            aria-label="搜索球队"
            onChange={(event: { target: { value: string } }) => setQuery(event.target.value)}
            placeholder="搜索球队或缩写"
            value={query}
          />
        </label>
        <label className="group-filter">
          小组
          <select
            aria-label="筛选小组"
            onChange={(event: { target: { value: string } }) => setGroupFilter(event.target.value)}
            value={groupFilter}
          >
            <option value="ALL">全部</option>
            {groupOptions.map((group) => (
              <option key={group} value={group}>
                {group} 组
              </option>
            ))}
          </select>
        </label>
        <label className="group-filter">
          排序
          <select
            aria-label="选择排序指标"
            onChange={(event: { target: { value: SortKey } }) => {
              setSortKey(event.target.value);
              setSortDirection(event.target.value === "name" ? "asc" : "desc");
            }}
            value={sortKey}
          >
            {sortableColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <div className="table-export-actions" aria-label="导出模拟结果">
          <button className="secondary-action" onClick={exportShareCard} type="button">
            <Icon name="trophy" size={15} />
            分享卡
          </button>
          <button className="secondary-action" onClick={() => exportSimulation("csv")} type="button">
            <Icon name="database" size={15} />
            CSV
          </button>
          <button className="secondary-action" onClick={() => exportSimulation("json")} type="button">
            <Icon name="database" size={15} />
            JSON
          </button>
        </div>
      </div>

      <div className="simulation-audit-strip" aria-label="模拟运行说明">
        <span>
          快照 <strong>{audit.snapshotLabel}</strong>
        </span>
        <span>
          数据 <strong>{audit.snapshotCollectedAt ? formatDateTime(audit.snapshotCollectedAt) : "未记录"}</strong>
        </span>
        <span>
          种子 <strong>{audit.seed}</strong>
        </span>
        <span>
          赛制 <strong>{audit.knockoutRuleSet.source === "placeholder" ? "占位规则" : "官方规则"}</strong>
        </span>
        <span>
          数据源 <strong>{audit.dataSources.length || "未记录"}</strong>
        </span>
      </div>

      <div className="simulation-table">
        <table>
          <thead>
            <tr>
              <th scope="col">排名</th>
              <th aria-sort={getSortAria("name")} scope="col">{renderSortButton("name", "球队")}</th>
              <th scope="col">标签</th>
              <th scope="col">小组</th>
              <th aria-sort={getSortAria("expectedPoints")} scope="col">{renderSortButton("expectedPoints", "预期分")}</th>
              <th scope="col">路径</th>
              <th aria-sort={getSortAria("round32")} scope="col">{renderSortButton("round32", "32强")}</th>
              <th aria-sort={getSortAria("round16")} scope="col">{renderSortButton("round16", "16强")}</th>
              <th aria-sort={getSortAria("quarterFinal")} scope="col">{renderSortButton("quarterFinal", "8强")}</th>
              <th aria-sort={getSortAria("semiFinal")} scope="col">{renderSortButton("semiFinal", "4强")}</th>
              <th aria-sort={getSortAria("final")} scope="col">{renderSortButton("final", "决赛")}</th>
              <th aria-sort={getSortAria("champion")} scope="col">{renderSortButton("champion", "冠军")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((summary, index) => {
              const team = teamsById.get(summary.teamId);
              const analysisTags = analysisTagsByTeamId.get(summary.teamId) ?? [];
              if (!team) {
                return null;
              }

              return (
                <tr key={summary.teamId}>
                  <td>{index + 1}</td>
                  <td>
                    <button
                      aria-expanded={selectedTeamId === team.id}
                      aria-haspopup="dialog"
                      className="team-detail-trigger"
                      onClick={() => setSelectedTeamId(team.id)}
                      type="button"
                    >
                      <i style={{ backgroundColor: team.color }} />
                      <strong>{team.name}</strong>
                      <em>{team.abbr}</em>
                    </button>
                  </td>
                  <td>
                    <AnalysisTags tags={analysisTags} compact />
                  </td>
                  <td>{summary.group}</td>
                  <td>{summary.expectedPoints.toFixed(2)}</td>
                  <td>
                    <RoundPath summary={summary} />
                  </td>
                  <td>{percent(summary.round32, 0)}</td>
                  <td>{percent(summary.round16, 0)}</td>
                  <td>{percent(summary.quarterFinal, 0)}</td>
                  <td>{percent(summary.semiFinal, 0)}</td>
                  <td>{percent(summary.final, 1)}</td>
                  <td>
                    <span className="champion-prob">
                      <b style={{ width: `${Math.max(2, summary.champion * 100)}%` }} />
                      <span>{percent(summary.champion, 1)}</span>
                    </span>
                    <span className="probability-interval">
                      {formatInterval(summary.championCiLow, summary.championCiHigh)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={12}>
                  没有匹配的球队
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedTeam && selectedSummary ? (
        <div className="drawer-backdrop" onClick={() => setSelectedTeamId(null)} role="presentation">
          <aside
            aria-describedby="team-drawer-note"
            aria-labelledby="team-drawer-title"
            aria-modal="true"
            className="team-drawer"
            onClick={(event: any) => event.stopPropagation()}
            role="dialog"
          >
            <div className="team-drawer__header">
              <div>
                <span className="eyebrow">{selectedTeam.group} 组球队</span>
                <h2 id="team-drawer-title">{selectedTeam.name}</h2>
                <p>{selectedTeam.abbr} · FIFA 第 {selectedTeam.fifaRank} · ELO {selectedTeam.elo}</p>
              </div>
              <button
                aria-label="关闭球队详情"
                className="drawer-close"
                onClick={() => setSelectedTeamId(null)}
                ref={drawerCloseRef}
                type="button"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="team-drawer__metrics">
              <DrawerMetric label="小组出线" value={selectedSummary.groupQualification} />
              <DrawerMetric label="16强" value={selectedSummary.round16} />
              <DrawerMetric label="8强" value={selectedSummary.quarterFinal} />
              <DrawerMetric
                detail={`95% 区间 ${formatInterval(
                  selectedSummary.championCiLow,
                  selectedSummary.championCiHigh
                )}`}
                label="冠军"
                value={selectedSummary.champion}
                highlight
              />
            </div>

            <div className="team-drawer__bars">
              <div className="subheading">模型标签</div>
              <AnalysisTags tags={analysisTagsByTeamId.get(selectedTeam.id) ?? []} />
            </div>

            <div className="team-drawer__bars">
              <div className="subheading">淘汰赛路径</div>
              <RoundPath summary={selectedSummary} expanded />
            </div>

            {selectedDrawerContext ? (
              <TeamDrawerContextPanel
                context={selectedDrawerContext}
                selectedSummary={selectedSummary}
                team={selectedTeam}
              />
            ) : null}

            <div className="team-drawer__profile">
              <div>
                <span>预期小组分</span>
                <strong>{selectedSummary.expectedPoints.toFixed(2)}</strong>
              </div>
              <div>
                <span>进攻评分</span>
                <strong>{selectedTeam.attack.toFixed(2)}</strong>
              </div>
              <div>
                <span>防守评分</span>
                <strong>{selectedTeam.defense.toFixed(2)}</strong>
              </div>
              <div>
                <span>近期状态</span>
                <strong>{selectedTeam.form.toFixed(2)}</strong>
              </div>
              <div>
                <span>伤停负荷</span>
                <strong>{selectedTeam.injuries.toFixed(2)}</strong>
              </div>
              <div>
                <span>东道主</span>
                <strong>{selectedTeam.host ? "是" : "否"}</strong>
              </div>
            </div>

            <p className="team-drawer__note" id="team-drawer-note">
              详情基于当前参数和随机种子生成；调整模型预设、权重或重新模拟后会同步刷新。
            </p>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function buildTeamDrawerContexts(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>,
  snapshot?: TournamentSnapshot
): Map<string, TeamDrawerContext> {
  const contexts = new Map<string, TeamDrawerContext>();
  const summariesByTeamId = new Map(simulation.teams.map((summary) => [summary.teamId, summary]));
  const fixtures = snapshot?.fixtures ?? [];
  const teams = snapshot?.teams ?? [...teamsById.values()];
  const actualStandings = snapshot
    ? Array.from(new Set(snapshot.teams.map((team) => team.group))).flatMap((group) =>
        calculateActualGroupStandings(
          snapshot.fixtures.filter((fixture) => fixture.group === group),
          snapshot.teams.filter((team) => team.group === group)
        )
      )
    : [];
  const actualRankByTeamId = new Map<string, { rank: number; standing: GroupStanding }>();

  for (const group of Array.from(new Set(actualStandings.map((standing) => standing.group)))) {
    actualStandings
      .filter((standing) => standing.group === group)
      .forEach((standing, index) => {
        actualRankByTeamId.set(standing.teamId, { rank: index + 1, standing });
      });
  }

  for (const summary of simulation.teams) {
    const team = teamsById.get(summary.teamId);
    if (!team) {
      continue;
    }

    const remainingFixtures = fixtures
      .filter(
        (fixture) =>
          fixture.status !== "completed" &&
          (fixture.homeTeamId === team.id || fixture.awayTeamId === team.id)
      )
      .sort(compareFixtureDates)
      .flatMap((fixture) => {
        const opponentId = fixture.homeTeamId === team.id ? fixture.awayTeamId : fixture.homeTeamId;
        const opponent = teamsById.get(opponentId);
        const opponentSummary = summariesByTeamId.get(opponentId);

        if (!opponent) {
          return [];
        }

        const pressure = getFixturePressure(team, opponent, opponentSummary);

        return [
          {
            fixture,
            opponent,
            ...(opponentSummary ? { opponentSummary } : {}),
            pressure,
            pressureLabel: getPressureLabel(pressure)
          }
        ];
      })
      .slice(0, 3);
    const actualRank = actualRankByTeamId.get(team.id);

    contexts.set(team.id, {
      actualStanding: actualRank?.standing,
      groupRank: actualRank?.rank,
      remainingFixtures,
      pathBreak: getLargestPathBreak(summary),
      riskNotes: buildTeamRiskNotes(summary, team, remainingFixtures, teams)
    });
  }

  return contexts;
}

function TeamDrawerContextPanel({
  context,
  selectedSummary,
  team
}: {
  context: TeamDrawerContext;
  selectedSummary: TeamSimulationSummary;
  team: Team;
}) {
  const standing = context.actualStanding;

  return (
    <div className="team-drawer__context">
      <section className="team-context-card">
        <div className="team-context-card__header">
          <strong>小组实时形势</strong>
          <span>{standing ? `第 ${context.groupRank} 名` : "暂无赛果"}</span>
        </div>
        <div className="team-context-grid">
          <ContextMetric label="积分" value={standing ? standing.points.toFixed(0) : "0"} />
          <ContextMetric label="战绩" value={standing ? `${standing.wins}-${standing.draws}-${standing.losses}` : "0-0-0"} />
          <ContextMetric label="净胜球" value={standing ? formatSignedNumber(standing.goalDifference) : "0"} />
          <ContextMetric label="模拟出线" value={percent(selectedSummary.groupQualification)} />
        </div>
      </section>

      <section className="team-context-card">
        <div className="team-context-card__header">
          <strong>剩余赛程压力</strong>
          <span>{context.remainingFixtures.length} 场</span>
        </div>
        {context.remainingFixtures.length > 0 ? (
          <div className="team-fixture-pressure-list">
            {context.remainingFixtures.map((item) => (
              <article className={`team-fixture-pressure team-fixture-pressure--${item.pressure}`} key={item.fixture.id}>
                <div>
                  <strong>{team.abbr} vs {item.opponent.abbr}</strong>
                  <span>{formatShortDate(item.fixture.date)} · {item.fixture.venue}</span>
                </div>
                <em>{item.pressureLabel}</em>
                <p>
                  对手 ELO {item.opponent.elo} · 出线 {item.opponentSummary ? percent(item.opponentSummary.groupQualification) : "未知"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="team-context-empty">当前快照没有该队剩余小组赛。</p>
        )}
      </section>

      <section className="team-context-card">
        <div className="team-context-card__header">
          <strong>路径断点与风险</strong>
          <span>{context.pathBreak.from} → {context.pathBreak.to}</span>
        </div>
        <div className="team-path-break">
          <strong>{percent(context.pathBreak.drop)}</strong>
          <span>最大概率损耗</span>
        </div>
        <div className="team-risk-list">
          {context.riskNotes.map((note) => (
            <article className={`team-risk-note team-risk-note--${note.tone}`} key={note.label}>
              <strong>{note.label}</strong>
              <span>{note.detail}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getFixturePressure(
  team: Team,
  opponent?: Team,
  opponentSummary?: TeamSimulationSummary
): "high" | "low" | "medium" {
  if (!opponent) {
    return "medium";
  }

  const eloGap = opponent.elo - team.elo;
  const opponentQualification = opponentSummary?.groupQualification ?? 0.5;

  if (eloGap >= 90 || opponentQualification >= 0.72) {
    return "high";
  }

  if (eloGap <= -110 && opponentQualification <= 0.45) {
    return "low";
  }

  return "medium";
}

function getPressureLabel(pressure: "high" | "low" | "medium"): string {
  if (pressure === "high") {
    return "高压";
  }

  if (pressure === "low") {
    return "可抢分";
  }

  return "中等";
}

function getLargestPathBreak(summary: TeamSimulationSummary) {
  const steps = [
    { from: "32强", to: "16强", drop: Math.max(0, summary.round32 - summary.round16) },
    { from: "16强", to: "8强", drop: Math.max(0, summary.round16 - summary.quarterFinal) },
    { from: "8强", to: "4强", drop: Math.max(0, summary.quarterFinal - summary.semiFinal) },
    { from: "4强", to: "决赛", drop: Math.max(0, summary.semiFinal - summary.final) },
    { from: "决赛", to: "冠军", drop: Math.max(0, summary.final - summary.champion) }
  ];

  return steps.sort((left, right) => right.drop - left.drop)[0];
}

function buildTeamRiskNotes(
  summary: TeamSimulationSummary,
  team: Team,
  remainingFixtures: TeamDrawerContext["remainingFixtures"],
  teams: Team[]
): TeamDrawerContext["riskNotes"] {
  const groupTeams = teams.filter((item) => item.group === team.group);
  const groupAverageElo =
    groupTeams.reduce((sum, item) => sum + item.elo, 0) / Math.max(1, groupTeams.length);
  const highPressureCount = remainingFixtures.filter((item) => item.pressure === "high").length;
  const notes: TeamDrawerContext["riskNotes"] = [];

  notes.push({
    label: summary.groupQualification >= 0.78 ? "出线稳定" : summary.groupQualification >= 0.48 ? "出线胶着" : "出线危险",
    detail: `小组出线概率 ${percent(summary.groupQualification)}，预期分 ${summary.expectedPoints.toFixed(2)}`,
    tone: summary.groupQualification >= 0.78 ? "green" : summary.groupQualification >= 0.48 ? "orange" : "red"
  });

  notes.push({
    label: highPressureCount > 0 ? "赛程有硬仗" : "赛程压力可控",
    detail: highPressureCount > 0 ? `剩余 ${highPressureCount} 场高压比赛` : "剩余对手整体压力不高",
    tone: highPressureCount > 0 ? "orange" : "green"
  });

  notes.push({
    label: team.elo >= groupAverageElo ? "实力高于组均" : "实力低于组均",
    detail: `本队 ELO ${team.elo}，小组均值 ${Math.round(groupAverageElo)}`,
    tone: team.elo >= groupAverageElo ? "green" : "red"
  });

  return notes;
}

function compareFixtureDates(left: Match, right: Match): number {
  const leftTime = Date.parse(left.date);
  const rightTime = Date.parse(right.date);

  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return left.id.localeCompare(right.id);
  }

  if (!Number.isFinite(leftTime)) {
    return 1;
  }

  if (!Number.isFinite(rightTime)) {
    return -1;
  }

  return leftTime - rightTime;
}

function formatShortDate(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    return "时间待定";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}`;
}

function buildAnalysisTagsByTeamId(simulation: SimulationSummary) {
  const sortedByChampion = [...simulation.teams].sort(
    (left, right) => right.champion - left.champion
  );
  const sortedByRound32 = [...simulation.teams].sort(
    (left, right) => right.round32 - left.round32
  );
  const topChampionIds = new Set(sortedByChampion.slice(0, 5).map((summary) => summary.teamId));
  const topRound32Ids = new Set(sortedByRound32.slice(0, 12).map((summary) => summary.teamId));
  const tagsByTeamId = new Map<string, TeamAnalysisTag[]>();

  simulation.teams.forEach((summary) => {
    const tags: TeamAnalysisTag[] = [];
    const titleConversion =
      summary.round32 > 0 ? summary.champion / Math.max(summary.round32, 0.001) : 0;
    const ciWidth = summary.championCiHigh - summary.championCiLow;

    if (topChampionIds.has(summary.teamId) && summary.champion >= 0.035) {
      tags.push({
        label: "冠军热门",
        detail: `夺冠概率 ${percent(summary.champion)}`,
        tone: "green"
      });
    }

    if (!topChampionIds.has(summary.teamId) && summary.champion >= 0.012 && summary.round32 < 0.74) {
      tags.push({
        label: "黑马",
        detail: `出线后仍有 ${percent(summary.champion)} 夺冠空间`,
        tone: "blue"
      });
    }

    if (topRound32Ids.has(summary.teamId) && titleConversion < 0.06 && summary.round32 >= 0.62) {
      tags.push({
        label: "路径压力",
        detail: `32强到冠军转化率 ${percent(titleConversion)}`,
        tone: "orange"
      });
    }

    if (ciWidth >= 0.055) {
      tags.push({
        label: "波动较高",
        detail: `冠军区间宽度 ${percent(ciWidth)}`,
        tone: "red"
      });
    }

    if (tags.length === 0) {
      tags.push({
        label: "稳定区间",
        detail: "模拟结果暂无异常标签",
        tone: "green"
      });
    }

    tagsByTeamId.set(summary.teamId, tags.slice(0, 3));
  });

  return tagsByTeamId;
}

function AnalysisTags({
  compact,
  tags
}: {
  compact?: boolean;
  tags: TeamAnalysisTag[];
}) {
  return (
    <div className={compact ? "analysis-tags analysis-tags--compact" : "analysis-tags"}>
      {tags.map((tag) => (
        <span
          className={`analysis-tag analysis-tag--${tag.tone}`}
          key={`${tag.label}-${tag.detail}`}
          title={tag.detail}
        >
          {tag.label}
          {!compact ? <em>{tag.detail}</em> : null}
        </span>
      ))}
    </div>
  );
}

type SimulationHighlightsData = {
  favorite?: {
    summary: TeamSimulationSummary;
    team: Team;
  };
  challenger?: {
    summary: TeamSimulationSummary;
    team: Team;
  };
  topFiveShare: number;
  averageChampionCiWidth: number;
  highestGroupQualification?: {
    summary: TeamSimulationSummary;
    team: Team;
  };
};

function buildSimulationHighlights(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>
): SimulationHighlightsData {
  const ranked = simulation.teams
    .map((summary) => ({
      summary,
      team: teamsById.get(summary.teamId)
    }))
    .filter((item): item is { summary: TeamSimulationSummary; team: Team } => Boolean(item.team));
  const topFive = ranked.slice(0, 5);
  const averageChampionCiWidth =
    topFive.length > 0
      ? topFive.reduce(
          (sum, item) => sum + item.summary.championCiHigh - item.summary.championCiLow,
          0
        ) / topFive.length
      : 0;
  const highestGroupQualification = [...ranked].sort(
    (left, right) => right.summary.groupQualification - left.summary.groupQualification
  )[0];

  return {
    favorite: ranked[0],
    challenger: ranked[1],
    topFiveShare: topFive.reduce((sum, item) => sum + item.summary.champion, 0),
    averageChampionCiWidth,
    highestGroupQualification
  };
}

function SimulationHighlights({ highlights }: { highlights: SimulationHighlightsData }) {
  const favoriteEdge =
    highlights.favorite && highlights.challenger
      ? highlights.favorite.summary.champion - highlights.challenger.summary.champion
      : 0;

  return (
    <div className="simulation-highlights" aria-label="模拟结果摘要">
      <HighlightCard
        accent="green"
        detail={
          highlights.challenger
            ? `领先 ${highlights.challenger.team.abbr} ${percent(favoriteEdge)}`
            : "暂无第二名数据"
        }
        label="夺冠热门"
        title={highlights.favorite?.team.name ?? "未计算"}
        value={highlights.favorite ? percent(highlights.favorite.summary.champion) : "-"}
      />
      <HighlightCard
        accent="blue"
        detail="Top 5 冠军概率合计"
        label="竞争集中度"
        title={formatRaceShape(highlights.topFiveShare)}
        value={percent(highlights.topFiveShare)}
      />
      <HighlightCard
        accent="orange"
        detail="Top 5 平均 95% 区间宽度"
        label="不确定性"
        title={formatUncertainty(highlights.averageChampionCiWidth)}
        value={percent(highlights.averageChampionCiWidth)}
      />
      <HighlightCard
        accent="green"
        detail={
          highlights.highestGroupQualification
            ? `${highlights.highestGroupQualification.team.abbr} 小组出线概率`
            : "暂无小组概率"
        }
        label="小组最稳"
        title={highlights.highestGroupQualification?.team.name ?? "未计算"}
        value={
          highlights.highestGroupQualification
            ? percent(highlights.highestGroupQualification.summary.groupQualification)
            : "-"
        }
      />
    </div>
  );
}

function HighlightCard({
  accent,
  detail,
  label,
  title,
  value
}: {
  accent: "blue" | "green" | "orange";
  detail: string;
  label: string;
  title: string;
  value: string;
}) {
  return (
    <article className={`simulation-highlight simulation-highlight--${accent}`}>
      <span>{label}</span>
      <div>
        <strong>{title}</strong>
        <em>{value}</em>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function formatRaceShape(topFiveShare: number): string {
  if (topFiveShare >= 0.72) {
    return "热门集中";
  }

  if (topFiveShare >= 0.52) {
    return "多强并列";
  }

  return "开放格局";
}

function formatUncertainty(value: number): string {
  if (value >= 0.08) {
    return "波动较高";
  }

  if (value >= 0.045) {
    return "中等波动";
  }

  return "相对稳定";
}

function formatInterval(low: number, high: number) {
  return `${percent(low, 1)}-${percent(high, 1)}`;
}

function DrawerMetric({
  detail,
  highlight,
  label,
  value
}: {
  detail?: string;
  highlight?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div className={highlight ? "drawer-metric is-highlight" : "drawer-metric"}>
      <span>{label}</span>
      <strong>{percent(value)}</strong>
      {detail ? <em>{detail}</em> : null}
    </div>
  );
}

function RoundPath({
  expanded,
  summary
}: {
  expanded?: boolean;
  summary: TeamSimulationSummary;
}) {
  const pathLabel = pathStages
    .map((stage) => `${stage.label}${percent(Number(summary[stage.key]), stage.key === "champion" || stage.key === "final" ? 1 : 0)}`)
    .join("，");

  return (
    <div
      aria-label={`淘汰赛晋级路径：${pathLabel}`}
      className={expanded ? "round-path round-path--expanded" : "round-path"}
      role="img"
    >
      {pathStages.map((stage) => {
        const value = Number(summary[stage.key]);

        return (
          <div className="round-path__stage" key={stage.key}>
            <span>
              <strong>{stage.label}</strong>
              {expanded ? <em>{percent(value, stage.key === "champion" || stage.key === "final" ? 1 : 0)}</em> : null}
            </span>
            <b style={{ height: `${Math.max(5, value * 100)}%` }} />
          </div>
        );
      })}
    </div>
  );
}
