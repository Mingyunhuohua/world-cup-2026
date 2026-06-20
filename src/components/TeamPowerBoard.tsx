import type { SimulationSummary, Team, TeamSimulationSummary } from "../types.ts";
import { percent } from "../utils/format.ts";
import { Icon } from "./Icon.tsx";

type TeamPowerBoardProps = {
  simulation: SimulationSummary;
  teams: Team[];
};

type TeamPowerItem = {
  team: Team;
  simulation?: TeamSimulationSummary;
  value: number;
  detail: string;
};

export function TeamPowerBoard({ simulation, teams }: TeamPowerBoardProps) {
  const simulationByTeamId = new Map(simulation.teams.map((summary) => [summary.teamId, summary]));
  const championLeaders = sortTeams(teams, (team) => simulationByTeamId.get(team.id)?.champion ?? 0)
    .slice(0, 4)
    .map((team) => ({
      team,
      simulation: simulationByTeamId.get(team.id),
      value: simulationByTeamId.get(team.id)?.champion ?? 0,
      detail: `16强 ${percent(simulationByTeamId.get(team.id)?.round16 ?? 0, 0)}`
    }));
  const formLeaders = sortTeams(teams, (team) => team.form)
    .slice(0, 4)
    .map((team) => ({
      team,
      simulation: simulationByTeamId.get(team.id),
      value: team.form,
      detail: `ELO ${team.elo}`
    }));
  const injuryRisks = sortTeams(teams, (team) => team.injuries)
    .slice(0, 4)
    .map((team) => ({
      team,
      simulation: simulationByTeamId.get(team.id),
      value: team.injuries,
      detail: `冠军 ${percent(simulationByTeamId.get(team.id)?.champion ?? 0)}`
    }));
  const hostTeams = teams
    .filter((team) => team.host)
    .sort((left, right) => (simulationByTeamId.get(right.id)?.champion ?? 0) - (simulationByTeamId.get(left.id)?.champion ?? 0))
    .map((team) => ({
      team,
      simulation: simulationByTeamId.get(team.id),
      value: simulationByTeamId.get(team.id)?.round16 ?? 0,
      detail: `出线 ${percent(simulationByTeamId.get(team.id)?.groupQualification ?? 0, 0)}`
    }));

  return (
    <section className="panel team-power-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">球队</span>
          <h2>实力与风险看板</h2>
        </div>
        <span className="table-meta">{teams.length} 队</span>
      </div>

      <div className="team-power-grid">
        <TeamPowerList
          icon="trophy"
          items={championLeaders}
          label="夺冠热门"
          valueFormatter={(value) => percent(value)}
        />
        <TeamPowerList
          icon="trending"
          items={formLeaders}
          label="近期状态"
          valueFormatter={(value) => value.toFixed(2)}
        />
        <TeamPowerList
          icon="alert"
          items={injuryRisks}
          label="伤停风险"
          tone="warning"
          valueFormatter={(value) => value.toFixed(2)}
        />
        <TeamPowerList
          icon="shield"
          items={hostTeams}
          label="东道主"
          valueFormatter={(value) => percent(value, 0)}
        />
      </div>
    </section>
  );
}

function TeamPowerList({
  icon,
  items,
  label,
  tone,
  valueFormatter
}: {
  icon: "alert" | "shield" | "trending" | "trophy";
  items: TeamPowerItem[];
  label: string;
  tone?: "warning";
  valueFormatter: (value: number) => string;
}) {
  return (
    <article className={tone === "warning" ? "team-power-card is-warning" : "team-power-card"}>
      <div className="team-power-card__header">
        <span>
          <Icon name={icon} size={15} />
        </span>
        <strong>{label}</strong>
      </div>
      <div className="team-power-list">
        {items.map((item, index) => (
          <div className="team-power-row" key={`${label}-${item.team.id}`}>
            <b>{index + 1}</b>
            <i style={{ backgroundColor: item.team.color }} />
            <div>
              <strong>{item.team.name}</strong>
              <span>
                {item.team.group} 组 · {item.detail}
              </span>
            </div>
            <em>{valueFormatter(item.value)}</em>
          </div>
        ))}
      </div>
    </article>
  );
}

function sortTeams(teams: Team[], getValue: (team: Team) => number): Team[] {
  return [...teams].sort((left, right) => getValue(right) - getValue(left));
}
