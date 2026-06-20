import type { DataSource, Match } from "../types.ts";
import { fifaFixturesSource, resultFallbackSource, scheduleFallbackSource } from "./sources.ts";
import { teams } from "./teams.ts";

type FixtureSpec = {
  id: string;
  group: string;
  matchday: number;
  date: string;
  venue: string;
  home: string;
  away: string;
  result?: {
    homeGoals: number;
    awayGoals: number;
    source: DataSource;
  };
};

const teamIds = new Map(teams.map((team) => [team.abbr, team.id]));

function id(abbr: string): string {
  const value = teamIds.get(abbr);
  if (!value) {
    throw new Error(`Missing team id for ${abbr}`);
  }
  return value;
}

function fixture(spec: FixtureSpec): Match {
  const source = spec.result ? spec.result.source : scheduleFallbackSource;

  return {
    id: spec.id,
    round: "GROUP",
    group: spec.group,
    matchday: spec.matchday,
    date: spec.date,
    venue: spec.venue,
    homeTeamId: id(spec.home),
    awayTeamId: id(spec.away),
    neutral: !["MEX", "CAN", "USA"].includes(spec.home) && !["MEX", "CAN", "USA"].includes(spec.away),
    status: spec.result ? "completed" : "scheduled",
    result: spec.result
      ? {
          homeGoals: spec.result.homeGoals,
          awayGoals: spec.result.awayGoals
        }
      : undefined,
    source: {
      ...source,
      notes: spec.result
        ? "已完赛比分已计入小组积分和蒙特卡洛模拟；后续由官方端点替换媒体核验。"
        : "赛程来自官方赛程页对应的手工核验快照；媒体赛程页用于补足当前前端无法稳定解析的公开 HTML。"
    }
  };
}

const specs: FixtureSpec[] = [
  {
    id: "A-1-1",
    group: "A",
    matchday: 1,
    date: "2026-06-11T19:00:00Z",
    venue: "Mexico City Stadium",
    home: "MEX",
    away: "RSA",
    result: { homeGoals: 2, awayGoals: 0, source: fifaFixturesSource }
  },
  {
    id: "A-1-2",
    group: "A",
    matchday: 1,
    date: "2026-06-12T01:00:00Z",
    venue: "Guadalajara Stadium",
    home: "KOR",
    away: "CZE",
    result: { homeGoals: 2, awayGoals: 1, source: fifaFixturesSource }
  },
  {
    id: "B-1-1",
    group: "B",
    matchday: 1,
    date: "2026-06-12T19:00:00Z",
    venue: "Toronto Stadium",
    home: "CAN",
    away: "BIH",
    result: { homeGoals: 1, awayGoals: 1, source: resultFallbackSource }
  },
  {
    id: "B-1-2",
    group: "B",
    matchday: 1,
    date: "2026-06-13T01:00:00Z",
    venue: "San Francisco Bay Area Stadium",
    home: "QAT",
    away: "SUI",
    result: { homeGoals: 1, awayGoals: 1, source: resultFallbackSource }
  },
  {
    id: "D-1-1",
    group: "D",
    matchday: 1,
    date: "2026-06-13T19:00:00Z",
    venue: "Los Angeles Stadium",
    home: "USA",
    away: "PAR",
    result: { homeGoals: 4, awayGoals: 1, source: resultFallbackSource }
  },
  {
    id: "C-1-1",
    group: "C",
    matchday: 1,
    date: "2026-06-13T22:00:00Z",
    venue: "New York New Jersey Stadium",
    home: "BRA",
    away: "MAR",
    result: { homeGoals: 1, awayGoals: 1, source: resultFallbackSource }
  },
  {
    id: "C-1-2",
    group: "C",
    matchday: 1,
    date: "2026-06-14T01:00:00Z",
    venue: "Boston Stadium",
    home: "HAI",
    away: "SCO",
    result: { homeGoals: 0, awayGoals: 1, source: resultFallbackSource }
  },
  {
    id: "D-1-2",
    group: "D",
    matchday: 1,
    date: "2026-06-14T01:00:00Z",
    venue: "Vancouver Stadium",
    home: "AUS",
    away: "TUR",
    result: { homeGoals: 2, awayGoals: 0, source: resultFallbackSource }
  },
  {
    id: "E-1-1",
    group: "E",
    matchday: 1,
    date: "2026-06-14T17:00:00Z",
    venue: "Houston Stadium",
    home: "GER",
    away: "CUW",
    result: { homeGoals: 7, awayGoals: 1, source: resultFallbackSource }
  },
  fixtureSpec("E-1-2", "E", 1, "2026-06-14T22:00:00Z", "Philadelphia Stadium", "CIV", "ECU", {
    homeGoals: 1,
    awayGoals: 0,
    source: resultFallbackSource
  }),
  fixtureSpec("F-1-1", "F", 1, "2026-06-14T20:00:00Z", "Dallas Stadium", "NED", "JPN", {
    homeGoals: 2,
    awayGoals: 2,
    source: resultFallbackSource
  }),
  fixtureSpec("F-1-2", "F", 1, "2026-06-15T01:00:00Z", "Monterrey Stadium", "SWE", "TUN", {
    homeGoals: 5,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("G-1-1", "G", 1, "2026-06-21T19:00:00Z", "Los Angeles Stadium", "BEL", "IRN"),
  fixtureSpec("G-1-2", "G", 1, "2026-06-22T01:00:00Z", "Vancouver Stadium", "NZL", "EGY"),
  fixtureSpec("H-1-1", "H", 1, "2026-06-15T17:00:00Z", "Atlanta Stadium", "ESP", "CPV", {
    homeGoals: 0,
    awayGoals: 0,
    source: resultFallbackSource
  }),
  fixtureSpec("H-1-2", "H", 1, "2026-06-15T20:00:00Z", "Miami Stadium", "KSA", "URU", {
    homeGoals: 1,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("I-1-1", "I", 1, "2026-06-16T19:00:00Z", "New York New Jersey Stadium", "FRA", "SEN", {
    homeGoals: 3,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("I-1-2", "I", 1, "2026-06-16T22:00:00Z", "Boston Stadium", "IRQ", "NOR", {
    homeGoals: 1,
    awayGoals: 4,
    source: resultFallbackSource
  }),
  fixtureSpec("J-1-1", "J", 1, "2026-06-18T01:00:00Z", "Kansas City Stadium", "ARG", "ALG", {
    homeGoals: 3,
    awayGoals: 0,
    source: resultFallbackSource
  }),
  fixtureSpec("J-1-2", "J", 1, "2026-06-18T22:00:00Z", "San Francisco Bay Area Stadium", "AUT", "JOR", {
    homeGoals: 3,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("K-1-1", "K", 1, "2026-06-18T19:00:00Z", "Houston Stadium", "POR", "COD", {
    homeGoals: 1,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("K-1-2", "K", 1, "2026-06-19T01:00:00Z", "Mexico City Stadium", "UZB", "COL", {
    homeGoals: 1,
    awayGoals: 3,
    source: resultFallbackSource
  }),
  fixtureSpec("L-1-1", "L", 1, "2026-06-17T20:00:00Z", "Dallas Stadium", "ENG", "CRO", {
    homeGoals: 4,
    awayGoals: 2,
    source: resultFallbackSource
  }),
  fixtureSpec("L-1-2", "L", 1, "2026-06-17T17:00:00Z", "Toronto Stadium", "GHA", "PAN", {
    homeGoals: 1,
    awayGoals: 0,
    source: resultFallbackSource
  }),

  fixtureSpec("A-2-1", "A", 2, "2026-06-18T22:00:00Z", "Atlanta Stadium", "MEX", "KOR", {
    homeGoals: 1,
    awayGoals: 0,
    source: resultFallbackSource
  }),
  fixtureSpec("A-2-2", "A", 2, "2026-06-18T19:00:00Z", "Atlanta Stadium", "CZE", "RSA", {
    homeGoals: 1,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("B-2-1", "B", 2, "2026-06-18T22:00:00Z", "Los Angeles Stadium", "SUI", "BIH", {
    homeGoals: 4,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("B-2-2", "B", 2, "2026-06-19T01:00:00Z", "Vancouver Stadium", "CAN", "QAT", {
    homeGoals: 6,
    awayGoals: 0,
    source: resultFallbackSource
  }),
  fixtureSpec("C-2-1", "C", 2, "2026-06-19T22:00:00Z", "Philadelphia Stadium", "BRA", "HAI", {
    homeGoals: 3,
    awayGoals: 0,
    source: resultFallbackSource
  }),
  fixtureSpec("C-2-2", "C", 2, "2026-06-19T19:00:00Z", "Boston Stadium", "SCO", "MAR", {
    homeGoals: 0,
    awayGoals: 1,
    source: resultFallbackSource
  }),
  fixtureSpec("D-2-1", "D", 2, "2026-06-21T01:00:00Z", "Seattle Stadium", "AUS", "PAR"),
  fixtureSpec("D-2-2", "D", 2, "2026-06-21T22:00:00Z", "Philadelphia Stadium", "USA", "TUR"),
  fixtureSpec("E-2-1", "E", 2, "2026-06-21T19:00:00Z", "Dallas Stadium", "GER", "CIV"),
  fixtureSpec("E-2-2", "E", 2, "2026-06-22T01:00:00Z", "Vancouver Stadium", "ECU", "CUW"),
  fixtureSpec("F-2-1", "F", 2, "2026-06-22T01:00:00Z", "New York New Jersey Stadium", "NED", "SWE"),
  fixtureSpec("F-2-2", "F", 2, "2026-06-22T22:00:00Z", "Mexico City Stadium", "TUN", "JPN"),
  fixtureSpec("G-2-1", "G", 2, "2026-06-22T19:00:00Z", "Houston Stadium", "BEL", "NZL"),
  fixtureSpec("G-2-2", "G", 2, "2026-06-23T01:00:00Z", "Los Angeles Stadium", "EGY", "IRN"),
  fixtureSpec("H-2-1", "H", 2, "2026-06-23T19:00:00Z", "Miami Stadium", "URU", "CPV"),
  fixtureSpec("H-2-2", "H", 2, "2026-06-23T22:00:00Z", "Atlanta Stadium", "ESP", "KSA"),
  fixtureSpec("I-2-1", "I", 2, "2026-06-23T22:00:00Z", "Boston Stadium", "FRA", "IRQ"),
  fixtureSpec("I-2-2", "I", 2, "2026-06-24T01:00:00Z", "Dallas Stadium", "NOR", "SEN"),
  fixtureSpec("J-2-1", "J", 2, "2026-06-24T01:00:00Z", "Atlanta Stadium", "ARG", "AUT"),
  fixtureSpec("J-2-2", "J", 2, "2026-06-24T22:00:00Z", "Vancouver Stadium", "JOR", "ALG"),
  fixtureSpec("K-2-1", "K", 2, "2026-06-24T19:00:00Z", "Kansas City Stadium", "POR", "UZB"),
  fixtureSpec("K-2-2", "K", 2, "2026-06-25T01:00:00Z", "Miami Stadium", "COL", "COD"),
  fixtureSpec("L-2-1", "L", 2, "2026-06-25T01:00:00Z", "Boston Stadium", "ENG", "GHA"),
  fixtureSpec("L-2-2", "L", 2, "2026-06-25T22:00:00Z", "Toronto Stadium", "PAN", "CRO"),

  fixtureSpec("A-3-1", "A", 3, "2026-06-24T22:00:00Z", "Mexico City Stadium", "CZE", "MEX"),
  fixtureSpec("A-3-2", "A", 3, "2026-06-24T22:00:00Z", "Monterrey Stadium", "RSA", "KOR"),
  fixtureSpec("B-3-1", "B", 3, "2026-06-25T22:00:00Z", "Vancouver Stadium", "CAN", "SUI"),
  fixtureSpec("B-3-2", "B", 3, "2026-06-25T22:00:00Z", "San Francisco Bay Area Stadium", "QAT", "BIH"),
  fixtureSpec("C-3-1", "C", 3, "2026-06-26T22:00:00Z", "Boston Stadium", "SCO", "BRA"),
  fixtureSpec("C-3-2", "C", 3, "2026-06-26T22:00:00Z", "Atlanta Stadium", "MAR", "HAI"),
  fixtureSpec("D-3-1", "D", 3, "2026-06-26T19:00:00Z", "Los Angeles Stadium", "AUS", "USA"),
  fixtureSpec("D-3-2", "D", 3, "2026-06-26T19:00:00Z", "Seattle Stadium", "PAR", "TUR"),
  fixtureSpec("E-3-1", "E", 3, "2026-06-27T19:00:00Z", "New York New Jersey Stadium", "ECU", "GER"),
  fixtureSpec("E-3-2", "E", 3, "2026-06-27T19:00:00Z", "Philadelphia Stadium", "CUW", "CIV"),
  fixtureSpec("F-3-1", "F", 3, "2026-06-27T22:00:00Z", "Dallas Stadium", "TUN", "NED"),
  fixtureSpec("F-3-2", "F", 3, "2026-06-27T22:00:00Z", "Houston Stadium", "JPN", "SWE"),
  fixtureSpec("G-3-1", "G", 3, "2026-06-28T22:00:00Z", "Los Angeles Stadium", "EGY", "BEL"),
  fixtureSpec("G-3-2", "G", 3, "2026-06-28T22:00:00Z", "Kansas City Stadium", "IRN", "NZL"),
  fixtureSpec("H-3-1", "H", 3, "2026-06-28T19:00:00Z", "Houston Stadium", "CPV", "KSA"),
  fixtureSpec("H-3-2", "H", 3, "2026-06-28T19:00:00Z", "Guadalajara Stadium", "URU", "ESP"),
  fixtureSpec("I-3-1", "I", 3, "2026-06-29T22:00:00Z", "New York New Jersey Stadium", "NOR", "FRA"),
  fixtureSpec("I-3-2", "I", 3, "2026-06-29T22:00:00Z", "Philadelphia Stadium", "SEN", "IRQ"),
  fixtureSpec("J-3-1", "J", 3, "2026-06-29T19:00:00Z", "Dallas Stadium", "JOR", "ARG"),
  fixtureSpec("J-3-2", "J", 3, "2026-06-29T19:00:00Z", "Kansas City Stadium", "ALG", "AUT"),
  fixtureSpec("K-3-1", "K", 3, "2026-06-30T22:00:00Z", "Miami Stadium", "COL", "POR"),
  fixtureSpec("K-3-2", "K", 3, "2026-06-30T22:00:00Z", "Houston Stadium", "COD", "UZB"),
  fixtureSpec("L-3-1", "L", 3, "2026-06-30T19:00:00Z", "New York New Jersey Stadium", "PAN", "ENG"),
  fixtureSpec("L-3-2", "L", 3, "2026-06-30T19:00:00Z", "Philadelphia Stadium", "CRO", "GHA")
];

function fixtureSpec(
  id: string,
  group: string,
  matchday: number,
  date: string,
  venue: string,
  home: string,
  away: string,
  result?: FixtureSpec["result"]
): FixtureSpec {
  return { id, group, matchday, date, venue, home, away, result };
}

export const fixtures: Match[] = specs.map(fixture);
