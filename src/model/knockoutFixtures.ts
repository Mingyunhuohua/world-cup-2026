import type { GroupStanding, Match, Round, Team } from "../types.ts";
import { calculateActualGroupStandings, sortStandings } from "./standings.ts";
import {
  buildRoundOf32Pairs,
  type QualifiedTeam,
  type RoundOf32QualifiedTeams
} from "./tournamentRules.ts";

// 淘汰赛赛程来源标记（与 fixtures.ts 的 scheduleFallbackSource 对齐，便于 UI 区分）。
const knockoutSource = {
  name: "淘汰赛对阵推导",
  kind: "manual" as const,
  updatedAt: "2026-06-28T00:00:00+08:00",
  confidence: "estimated" as const,
  notes:
    "小组赛全部完赛后，由真实小组排名 + FIFA 官方 32 强对位规则自动推导；后续轮次在上一轮完赛后逐轮生成。"
};

// 与 simulate.ts 中 selectRoundOf32 等价的实现（simulate 内部未导出该函数，这里复刻一份）。
function selectRoundOf32(
  standingsByGroup: Map<string, GroupStanding[]>
): RoundOf32QualifiedTeams {
  const firsts: QualifiedTeam[] = [];
  const seconds: QualifiedTeam[] = [];
  const thirds: QualifiedTeam[] = [];

  for (const [group, standings] of [...standingsByGroup.entries()].sort()) {
    standings.forEach((standing, index) => {
      const qualified = {
        teamId: standing.teamId,
        group,
        rank: index + 1,
        standing
      };
      if (index === 0) firsts.push(qualified);
      if (index === 1) seconds.push(qualified);
      if (index === 2) thirds.push(qualified);
    });
  }

  const bestThirds = thirds
    .sort((a, b) => sortStandings(a.standing, b.standing))
    .slice(0, 8);

  return { firsts, seconds, bestThirds };
}

// 判定一场淘汰赛是否已完赛（有真实比分）。
function isCompleted(match: Match | undefined): match is Match {
  return Boolean(match && match.result);
}

// 取一场淘汰赛的胜者 teamId（常规时间胜出；平局时取主队作为兜底——
// 真实赛果数据进入前不应出现平局胜者，平局由赛果数据本身解决）。
function winnerOf(match: Match): string {
  const { homeGoals, awayGoals } = match.result ?? { homeGoals: 0, awayGoals: 0 };
  if (homeGoals >= awayGoals) {
    return match.homeTeamId;
  }
  return match.awayTeamId;
}

function buildKnockoutMatch(
  id: string,
  round: Round,
  homeTeamId: string,
  awayTeamId: string,
  venue: string
): Match {
  return {
    id,
    round,
    date: "",
    venue,
    homeTeamId,
    awayTeamId,
    neutral: true,
    status: "scheduled",
    source: { ...knockoutSource }
  };
}

/**
 * 用真实小组排名 + FIFA 官方对位规则生成 32 强对阵，并在上一轮全部完赛后逐轮
 * 推进 16 强 / 8 强 / 半决赛 / 决赛。
 *
 * - 输入：含已完赛小组赛比分的 fixtures（GROUP 比赛）与全部球队。
 * - 小组赛未全部完赛时返回空数组，保持现有行为不变。
 * - 后续轮次（R16/QF/SF/FINAL）只在"上一轮所有比赛都已完赛"时生成，
 *   避免对阵悬空。已完赛的淘汰赛比分（来自 results-live.json 同步）会被保留。
 *
 * 注意：本函数是幂等的纯函数，可在每次赛果同步后整体重算。
 */
export function buildKnockoutFixtures(fixtures: Match[], teams: Team[]): Match[] {
  const groupMatches = fixtures.filter((match) => match.round === "GROUP");
  const teamsByGroup = new Map<string, Team[]>();
  teams.forEach((team) => {
    const list = teamsByGroup.get(team.group) ?? [];
    list.push(team);
    teamsByGroup.set(team.group, list);
  });

  // 逐组用真实比分算排名。
  const standingsByGroup = new Map<string, GroupStanding[]>();
  for (const [group, groupTeams] of teamsByGroup) {
    const matches = groupMatches.filter((match) => match.group === group);
    standingsByGroup.set(group, calculateActualGroupStandings(matches, groupTeams));
  }

  // 小组赛未全部完赛则不生成淘汰赛（任一组完赛场次不足 6 场即视为未完赛）。
  const allGroupComplete = [...standingsByGroup.values()].every(
    (standings) => standings.every((standing) => standing.played >= 3)
  );
  if (!allGroupComplete) {
    return [];
  }

  const qualified = selectRoundOf32(standingsByGroup);
  const round32Pairs = buildRoundOf32Pairs(qualified);

  // 32 强对阵：沿用现有 fixtures 里已存在的 R32 比赛（保留已同步的真实赛果），
  // 缺失的补齐。按 pair 顺序与 officialRoundOf32Slots 的 matchNumber 73-88 对齐。
  const existingByRound = new Map<Round, Map<string, Match>>();
  for (const round of ["R32", "R16", "QF", "SF", "FINAL"] as Round[]) {
    const byId = new Map<string, Match>();
    fixtures
      .filter((match) => match.round === round)
      .forEach((match) => byId.set(match.id, match));
    existingByRound.set(round, byId);
  }

  const r32Venues = [
    "32强·1", "32强·2", "32强·3", "32强·4",
    "32强·5", "32强·6", "32强·7", "32强·8",
    "32强·9", "32强·10", "32强·11", "32强·12",
    "32强·13", "32强·14", "32强·15", "32强·16"
  ];

  const round32Matches: Match[] = round32Pairs.map((pair, index) => {
    const matchNumber = 73 + index;
    const id = `ko-r32-${matchNumber}`;
    const existing = existingByRound.get("R32")?.get(id);
    if (existing) {
      return existing;
    }
    return buildKnockoutMatch(
      id,
      "R32",
      pair[0].teamId,
      pair[1].teamId,
      r32Venues[index] ?? `32强·${index + 1}`
    );
  });

  const result: Match[] = [...round32Matches];

  // 逐轮推进：上一轮全部完赛才生成下一轮，对阵按下标两两配对（与 simulate.ts 一致）。
  const roundDefs: { round: Round; next: Round; label: string; startNo: number }[] = [
    { round: "R32", next: "R16", label: "16强", startNo: 89 },
    { round: "R16", next: "QF", label: "8强", startNo: 97 },
    { round: "QF", next: "SF", label: "半决赛", startNo: 101 },
    { round: "SF", next: "FINAL", label: "决赛", startNo: 103 }
  ];

  let currentRoundMatches = round32Matches;
  for (const def of roundDefs) {
    // 上一轮必须全部完赛，否则停止推进。
    if (!currentRoundMatches.every(isCompleted)) {
      break;
    }

    const winners: string[] = currentRoundMatches.map(winnerOf);
    const nextMatches: Match[] = [];
    for (let index = 0; index < winners.length; index += 2) {
      const home = winners[index];
      const away = winners[index + 1];
      if (!home || !away) {
        continue;
      }
      const matchNumber = def.startNo + Math.floor(index / 2);
      const id = `ko-${def.next.toLowerCase()}-${matchNumber}`;
      const existing = existingByRound.get(def.next)?.get(id);
      nextMatches.push(
        existing ??
          buildKnockoutMatch(id, def.next, home, away, `${def.label}·${Math.floor(index / 2) + 1}`)
      );
    }
    result.push(...nextMatches);
    currentRoundMatches = nextMatches;
  }

  return result;
}
