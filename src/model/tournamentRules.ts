import type { GroupStanding } from "../types.ts";

export type QualifiedTeam = {
  teamId: string;
  group: string;
  rank: number;
  standing: GroupStanding;
};

export type RoundOf32QualifiedTeams = {
  firsts: QualifiedTeam[];
  seconds: QualifiedTeam[];
  bestThirds: QualifiedTeam[];
};

export type RoundOf32Pair = [QualifiedTeam, QualifiedTeam];

export type KnockoutRuleSet = {
  id: string;
  label: string;
  source: "official" | "placeholder";
  notes: string;
  buildRoundOf32Pairs: (qualified: RoundOf32QualifiedTeams) => RoundOf32Pair[];
};

function buildMvpSeededRoundOf32Pairs(
  qualified: RoundOf32QualifiedTeams
): RoundOf32Pair[] {
  const { firsts, seconds, bestThirds } = qualified;
  const getFirst = (index: number) => firsts[index % firsts.length];
  const getSecond = (index: number) => seconds[index % seconds.length];
  const getThird = (index: number) => bestThirds[index % bestThirds.length];

  return [
    [getFirst(0), getThird(7)],
    [getFirst(1), getThird(6)],
    [getFirst(2), getThird(5)],
    [getFirst(3), getThird(4)],
    [getFirst(4), getThird(3)],
    [getFirst(5), getThird(2)],
    [getFirst(6), getThird(1)],
    [getFirst(7), getThird(0)],
    [getFirst(8), getSecond(11)],
    [getFirst(9), getSecond(10)],
    [getFirst(10), getSecond(9)],
    [getFirst(11), getSecond(8)],
    [getSecond(0), getSecond(1)],
    [getSecond(2), getSecond(3)],
    [getSecond(4), getSecond(5)],
    [getSecond(6), getSecond(7)]
  ].filter((pair): pair is RoundOf32Pair => Boolean(pair[0] && pair[1]));
}

export const mvpSeededKnockoutRuleSet: KnockoutRuleSet = {
  id: "mvp-seeded-2026-placeholder",
  label: "MVP 种子占位对位",
  source: "placeholder",
  notes:
    "按小组第一、第二和最佳第三名构造稳定 32 强对位。该规则用于模拟闭环兜底，不代表 FIFA 官方 2026 淘汰赛对位映射。",
  buildRoundOf32Pairs: buildMvpSeededRoundOf32Pairs
};

// FIFA 2026 世界杯官方淘汰赛规程：32 强对位结构固定（见官方赛程 73-88 号比赛），
// 8 个出线名额给小组第一/第二的固定对位，另外 8 个名额留给"最佳第三名"，
// 具体由哪个小组的第三名顶上由官方附件 C（495 种组合）决定。
// 下面的顺序经过编排，使后续轮次按数组下标两两顺序配对时，
// 晋级路径与官方半区结构（16强→8强→4强→决赛）完全一致。
type AnchorRole = "winner" | "runnerup";
type Anchor = { role: AnchorRole; group: string };
type FixedSlot = { kind: "fixed"; matchNumber: number; home: Anchor; away: Anchor };
type ThirdSlot = {
  kind: "third";
  matchNumber: number;
  anchor: Anchor;
  eligibleGroups: string[];
};
type BracketSlot = FixedSlot | ThirdSlot;

const officialRoundOf32Slots: BracketSlot[] = [
  {
    kind: "third",
    matchNumber: 74,
    anchor: { role: "winner", group: "E" },
    eligibleGroups: ["A", "B", "C", "D", "F"]
  },
  {
    kind: "third",
    matchNumber: 77,
    anchor: { role: "winner", group: "I" },
    eligibleGroups: ["C", "D", "F", "G", "H"]
  },
  {
    kind: "fixed",
    matchNumber: 73,
    home: { role: "runnerup", group: "A" },
    away: { role: "runnerup", group: "B" }
  },
  {
    kind: "fixed",
    matchNumber: 75,
    home: { role: "winner", group: "F" },
    away: { role: "runnerup", group: "C" }
  },
  {
    kind: "fixed",
    matchNumber: 83,
    home: { role: "runnerup", group: "K" },
    away: { role: "runnerup", group: "L" }
  },
  {
    kind: "fixed",
    matchNumber: 84,
    home: { role: "winner", group: "H" },
    away: { role: "runnerup", group: "J" }
  },
  {
    kind: "third",
    matchNumber: 81,
    anchor: { role: "winner", group: "D" },
    eligibleGroups: ["B", "E", "F", "I", "J"]
  },
  {
    kind: "third",
    matchNumber: 82,
    anchor: { role: "winner", group: "G" },
    eligibleGroups: ["A", "E", "H", "I", "J"]
  },
  {
    kind: "fixed",
    matchNumber: 76,
    home: { role: "winner", group: "C" },
    away: { role: "runnerup", group: "F" }
  },
  {
    kind: "fixed",
    matchNumber: 78,
    home: { role: "runnerup", group: "E" },
    away: { role: "runnerup", group: "I" }
  },
  {
    kind: "third",
    matchNumber: 79,
    anchor: { role: "winner", group: "A" },
    eligibleGroups: ["C", "E", "F", "H", "I"]
  },
  {
    kind: "third",
    matchNumber: 80,
    anchor: { role: "winner", group: "L" },
    eligibleGroups: ["E", "H", "I", "J", "K"]
  },
  {
    kind: "fixed",
    matchNumber: 86,
    home: { role: "winner", group: "J" },
    away: { role: "runnerup", group: "H" }
  },
  {
    kind: "fixed",
    matchNumber: 88,
    home: { role: "runnerup", group: "D" },
    away: { role: "runnerup", group: "G" }
  },
  {
    kind: "third",
    matchNumber: 85,
    anchor: { role: "winner", group: "B" },
    eligibleGroups: ["E", "F", "G", "I", "J"]
  },
  {
    kind: "third",
    matchNumber: 87,
    anchor: { role: "winner", group: "K" },
    eligibleGroups: ["D", "E", "I", "J", "L"]
  }
];

const officialGroupOrder = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

// Kuhn 算法：为每个"最佳第三名"对位槛位匹配一个符合资格的实际晋级第三名小组。
// FIFA 官方附件 C 针对全部 495 种晋级组合都保证存在合法匹配；
// 当多个合法匹配同时存在时，本算法按固定顺序选出其中一个，
// 不保证与官方附件 C 逐行一致，但保证每场都在规则允许的对位范围内。
function matchThirdPlaceSlots(
  slots: ThirdSlot[],
  qualifiedThirdGroups: string[]
): Map<number, string> | undefined {
  const slotHoldingGroup = new Map<string, number>();

  function tryAssign(slotIndex: number, visited: Set<string>): boolean {
    const slot = slots[slotIndex];
    for (const group of qualifiedThirdGroups) {
      if (!slot.eligibleGroups.includes(group) || visited.has(group)) {
        continue;
      }
      visited.add(group);
      const occupant = slotHoldingGroup.get(group);
      if (occupant === undefined || tryAssign(occupant, visited)) {
        slotHoldingGroup.set(group, slotIndex);
        return true;
      }
    }
    return false;
  }

  for (let index = 0; index < slots.length; index += 1) {
    if (!tryAssign(index, new Set())) {
      return undefined;
    }
  }

  const assignment = new Map<number, string>();
  for (const [group, slotIndex] of slotHoldingGroup) {
    assignment.set(slotIndex, group);
  }
  return assignment;
}

function buildOfficial2026RoundOf32Pairs(
  qualified: RoundOf32QualifiedTeams
): RoundOf32Pair[] | undefined {
  const { firsts, seconds, bestThirds } = qualified;
  const firstsByGroup = new Map(firsts.map((team) => [team.group, team]));
  const secondsByGroup = new Map(seconds.map((team) => [team.group, team]));
  const thirdsByGroup = new Map(bestThirds.map((team) => [team.group, team]));

  const hasAllGroups = officialGroupOrder.every(
    (group) => firstsByGroup.has(group) && secondsByGroup.has(group)
  );
  if (!hasAllGroups || thirdsByGroup.size !== 8) {
    return undefined;
  }

  const thirdSlots = officialRoundOf32Slots.filter(
    (slot): slot is ThirdSlot => slot.kind === "third"
  );
  const qualifiedThirdGroups = [...thirdsByGroup.keys()].sort();
  const slotAssignment = matchThirdPlaceSlots(thirdSlots, qualifiedThirdGroups);
  if (!slotAssignment) {
    return undefined;
  }

  function resolveAnchor(anchor: Anchor): QualifiedTeam | undefined {
    return anchor.role === "winner"
      ? firstsByGroup.get(anchor.group)
      : secondsByGroup.get(anchor.group);
  }

  const pairs: RoundOf32Pair[] = [];
  for (const slot of officialRoundOf32Slots) {
    if (slot.kind === "fixed") {
      const home = resolveAnchor(slot.home);
      const away = resolveAnchor(slot.away);
      if (!home || !away) {
        return undefined;
      }
      pairs.push([home, away]);
    } else {
      const slotIndex = thirdSlots.indexOf(slot);
      const assignedGroup = slotAssignment.get(slotIndex);
      const home = resolveAnchor(slot.anchor);
      const away = assignedGroup ? thirdsByGroup.get(assignedGroup) : undefined;
      if (!home || !away) {
        return undefined;
      }
      pairs.push([home, away]);
    }
  }

  return pairs;
}

export const official2026KnockoutRuleSet: KnockoutRuleSet = {
  id: "fifa-2026-official-bracket",
  label: "FIFA 官方对位结构",
  source: "official",
  notes:
    "32 强对位严格遵循官方赛程编号（73-88）与晋级路径（16强→8强→4强→决赛）；" +
    "最佳第三名具体顶替哪个对位槛位按官方附件 C 的资格范围用稳定匹配算法求解，" +
    "多解情况下不保证与附件 C 逐行一致，但始终落在规则允许范围内。",
  buildRoundOf32Pairs: (qualified) =>
    buildOfficial2026RoundOf32Pairs(qualified) ?? buildMvpSeededRoundOf32Pairs(qualified)
};

export const activeKnockoutRuleSet = official2026KnockoutRuleSet;

export function buildRoundOf32Pairs(
  qualified: RoundOf32QualifiedTeams,
  ruleSet: KnockoutRuleSet = activeKnockoutRuleSet
): RoundOf32Pair[] {
  return ruleSet.buildRoundOf32Pairs(qualified);
}
