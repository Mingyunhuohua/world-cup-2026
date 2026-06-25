import assert from "node:assert/strict";
import test from "node:test";
import { buildResultPatches } from "../src/data/liveSignalSync.ts";
import { buildCompletedResults } from "../scripts/adapters/match-results.mjs";

function team(id, abbr) {
  return {
    id,
    abbr,
    name: abbr,
    group: "A",
    fifaRank: 10,
    elo: 1800,
    attack: 1,
    defense: 1,
    form: 0,
    injuries: 0,
    host: false,
    color: "#000",
    source: { id: "t", label: "t", status: "active", retrievedAt: "2026-06-20T00:00:00Z" }
  };
}

function fixture(id, homeTeamId, awayTeamId, status, result) {
  return {
    id,
    round: "GROUP",
    group: "A",
    matchday: 1,
    date: "2026-06-20T00:00:00Z",
    venue: "Test",
    homeTeamId,
    awayTeamId,
    neutral: false,
    status,
    result,
    source: { id: "t", label: "t", status: "active", retrievedAt: "2026-06-20T00:00:00Z" }
  };
}

function snapshot(fixtures) {
  return {
    id: "s",
    label: "s",
    collectedAt: "2026-06-20T00:00:00Z",
    teams: [team("mex", "MEX"), team("rsa", "RSA"), team("kor", "KOR")],
    fixtures,
    sources: [],
    completedMatches: 0,
    scheduledMatches: fixtures.length,
    notes: []
  };
}

test("赛果匹配会把外部比分按本地主客方向归位", () => {
  // 本地赛程主队是 MEX，但外部来源以 RSA 为主队上报，比分需要翻转归位。
  const snap = snapshot([fixture("A-1-1", "mex", "rsa", "scheduled")]);
  const patches = buildResultPatches(snap, [
    { homeAbbr: "RSA", awayAbbr: "MEX", homeGoals: 0, awayGoals: 2 }
  ]);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].matchId, "A-1-1");
  assert.equal(patches[0].homeGoals, 2); // MEX 进 2
  assert.equal(patches[0].awayGoals, 0); // RSA 进 0
});

test("赛果匹配会跳过已记录相同比分、保留不同比分", () => {
  const snap = snapshot([
    fixture("A-1-1", "mex", "rsa", "completed", { homeGoals: 2, awayGoals: 0 }),
    fixture("A-2-1", "mex", "kor", "scheduled")
  ]);
  const patches = buildResultPatches(snap, [
    { homeAbbr: "MEX", awayAbbr: "RSA", homeGoals: 2, awayGoals: 0 }, // 与已记录相同 → 跳过
    { homeAbbr: "MEX", awayAbbr: "KOR", homeGoals: 1, awayGoals: 0 } // 新结果 → 保留
  ]);

  assert.equal(patches.length, 1);
  assert.equal(patches[0].matchId, "A-2-1");
});

test("赛果匹配会跳过赛程中不存在的对阵", () => {
  const snap = snapshot([fixture("A-1-1", "mex", "rsa", "scheduled")]);
  const patches = buildResultPatches(snap, [
    { homeAbbr: "KOR", awayAbbr: "RSA", homeGoals: 1, awayGoals: 1 }
  ]);

  assert.equal(patches.length, 0);
});

test("赛果适配器会解析已完赛比分并跳过未完赛与无映射球队", () => {
  const { completedResults, warnings } = buildCompletedResults([
    {
      completed: true,
      home_team: "Argentina",
      away_team: "Austria",
      scores: [
        { name: "Argentina", score: "2" },
        { name: "Austria", score: "0" }
      ]
    },
    {
      completed: false,
      home_team: "France",
      away_team: "Iraq",
      scores: null
    },
    {
      completed: true,
      home_team: "Atlantis",
      away_team: "Spain",
      scores: [
        { name: "Atlantis", score: "1" },
        { name: "Spain", score: "1" }
      ]
    }
  ]);

  assert.equal(completedResults.length, 1);
  assert.deepEqual(completedResults[0], {
    homeAbbr: "ARG",
    awayAbbr: "AUT",
    homeGoals: 2,
    awayGoals: 0,
    commenceTime: undefined
  });
  assert.ok(warnings.some((line) => line.includes("Atlantis")));
});
