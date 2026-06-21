import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompletedResultsSignature,
  deriveRecentFormSignals
} from "../src/data/recentFormSignal.ts";

function buildSnapshot(fixtures) {
  return {
    id: "test-snapshot",
    label: "test",
    collectedAt: "2026-06-21T00:00:00Z",
    teams: [],
    fixtures,
    sources: [],
    completedMatches: fixtures.filter((fixture) => fixture.status === "completed").length,
    scheduledMatches: fixtures.filter((fixture) => fixture.status !== "completed").length,
    notes: []
  };
}

function fixture(id, homeTeamId, awayTeamId, status, result) {
  return {
    id,
    round: "GROUP",
    group: "A",
    matchday: 1,
    date: "2026-06-15T00:00:00Z",
    venue: "Test Stadium",
    homeTeamId,
    awayTeamId,
    neutral: false,
    status,
    result,
    source: { id: "test", label: "test", status: "active", retrievedAt: "2026-06-15T00:00:00Z" }
  };
}

test("近期战绩信号会忽略未完赛比赛", () => {
  const snapshot = buildSnapshot([
    fixture("m1", "arg", "bra", "scheduled")
  ]);

  const signals = deriveRecentFormSignals(snapshot);

  assert.equal(signals.size, 0);
});

test("近期战绩信号对连胜大比分球队给出正向 form", () => {
  const snapshot = buildSnapshot([
    fixture("m1", "arg", "bra", "completed", { homeGoals: 3, awayGoals: 0 }),
    fixture("m2", "arg", "ger", "completed", { homeGoals: 2, awayGoals: 0 })
  ]);

  const signals = deriveRecentFormSignals(snapshot);
  const argSignal = signals.get("arg");
  const braSignal = signals.get("bra");

  assert.ok(argSignal);
  assert.equal(argSignal.matches, 2);
  assert.ok(argSignal.form > 0, "两连胜应得到正向 form");
  assert.ok(braSignal.form < 0, "连败应得到负向 form");
  assert.ok(argSignal.form <= 0.22 && argSignal.form >= -0.22, "form 必须落在限定区间内");
});

test("近期战绩信号对平局给出接近中性的 form", () => {
  const snapshot = buildSnapshot([
    fixture("m1", "usa", "mex", "completed", { homeGoals: 1, awayGoals: 1 })
  ]);

  const signals = deriveRecentFormSignals(snapshot);
  const usaSignal = signals.get("usa");

  assert.ok(Math.abs(usaSignal.form) < 0.06, "1-1 平局的 form 应接近中性，明显小于连胜/连败的偏移幅度");
});

test("已完赛签名与比赛顺序无关，但内容变化会改变签名", () => {
  const snapshotA = buildSnapshot([
    fixture("m1", "arg", "bra", "completed", { homeGoals: 3, awayGoals: 0 }),
    fixture("m2", "usa", "mex", "completed", { homeGoals: 1, awayGoals: 1 })
  ]);
  const snapshotB = buildSnapshot([
    fixture("m2", "usa", "mex", "completed", { homeGoals: 1, awayGoals: 1 }),
    fixture("m1", "arg", "bra", "completed", { homeGoals: 3, awayGoals: 0 })
  ]);
  const snapshotC = buildSnapshot([
    fixture("m1", "arg", "bra", "completed", { homeGoals: 4, awayGoals: 0 }),
    fixture("m2", "usa", "mex", "completed", { homeGoals: 1, awayGoals: 1 })
  ]);

  assert.equal(
    buildCompletedResultsSignature(snapshotA),
    buildCompletedResultsSignature(snapshotB)
  );
  assert.notEqual(
    buildCompletedResultsSignature(snapshotA),
    buildCompletedResultsSignature(snapshotC)
  );
});
