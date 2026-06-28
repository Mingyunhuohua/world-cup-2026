import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportModelImpact,
  currentTournamentSnapshot,
  buildBulkResultsTemplate,
  buildCombinedDataPackageTemplate,
  buildFixtureImportHelpers,
  buildFixturePatchTemplate,
  buildSnapshotFilename,
  buildResultImportTemplate,
  clearImportHistory,
  clearImportRecapHistory,
  clearRuntimeSnapshot,
  fixtures,
  importTournamentJson,
  loadImportHistory,
  loadImportRecapHistory,
  loadRuntimeSnapshot,
  previewTournamentImport,
  saveImportHistoryEntry,
  saveImportRecapHistoryEntry,
  saveRuntimeSnapshot,
  serializeTournamentSnapshot,
  snapshotAdapter,
  teams,
  validateTournamentSnapshot
} from "../src/data/index.ts";
import { defaultModelConfig } from "../src/model/config.ts";
import {
  clearModelConfig,
  loadModelConfig,
  parseModelConfigImport,
  saveModelConfig,
  serializeModelConfig
} from "../src/model/configStorage.ts";
import { compareModelConfigurations, evaluateCompletedMatches } from "../src/model/evaluation.ts";
import { calculateGroupDifficulty } from "../src/model/groupDifficulty.ts";
import { buildParameterInsights } from "../src/model/insights.ts";
import { buildScoreMatrix } from "../src/model/poisson.ts";
import { calculateTeamRestDays, predictMatch } from "../src/model/predict.ts";
import {
  countChangedConfigKeys,
  getPresetIdForConfig,
  modelPresets
} from "../src/model/presets.ts";
import {
  applyKnockoutSuspensionRisk,
  calculateSuspensionLoad,
  clearPredictionCache,
  getPredictionCacheSize,
  getWilsonInterval,
  resolveKnockoutWinner,
  simulateTournament,
  simulateTournamentWithProgress
} from "../src/model/simulate.ts";
import {
  calculateFairPlayPoints,
  calculateActualGroupStandings,
  groupTieBreakerSteps
} from "../src/model/standings.ts";
import {
  activeKnockoutRuleSet,
  buildRoundOf32Pairs,
  mvpSeededKnockoutRuleSet
} from "../src/model/tournamentRules.ts";
import {
  buildSimulationAuditSummary,
  buildSimulationExportFilename,
  buildSimulationShareFilename,
  serializeSimulationCsv,
  serializeSimulationJson,
  serializeSimulationShareSvg
} from "../src/utils/simulationExport.ts";
import {
  buildSimulationWorkerProgress,
  buildSimulationWorkerRequest,
  getSimulationProgressStep,
  isSimulationWorkerRequest
} from "../src/workers/simulationProtocol.ts";

const source = {
  name: "test",
  updatedAt: "2026-01-01T00:00:00Z",
  confidence: "seed"
};

test("泊松比分矩阵会归一化到 1", () => {
  const matrix = buildScoreMatrix(1.42, 1.08, 7, -0.08);
  const total = matrix.reduce((sum, score) => sum + score.probability, 0);

  assert.ok(Math.abs(total - 1) < 1e-8);
});

test("胜平负概率与比分矩阵聚合一致", () => {
  const matrix = buildScoreMatrix(1.8, 0.9, 7, -0.08);
  const home = matrix
    .filter((score) => score.homeGoals > score.awayGoals)
    .reduce((sum, score) => sum + score.probability, 0);
  const draw = matrix
    .filter((score) => score.homeGoals === score.awayGoals)
    .reduce((sum, score) => sum + score.probability, 0);
  const away = matrix
    .filter((score) => score.homeGoals < score.awayGoals)
    .reduce((sum, score) => sum + score.probability, 0);

  assert.ok(Math.abs(home + draw + away - 1) < 1e-8);
  assert.ok(home > away);
});

test("比赛预测会按双方休息天数调整预期进球", () => {
  const sampleTeams = [
    buildTeam("a", 1800),
    buildTeam("b", 1800),
    buildTeam("c", 1700),
    buildTeam("d", 1700)
  ];
  const previousA = {
    ...buildMatch("prev-a", "a", "c", 1, 0),
    date: "2026-06-01T12:00:00Z"
  };
  const previousB = {
    ...buildMatch("prev-b", "b", "d", 1, 0),
    date: "2026-06-04T12:00:00Z"
  };
  const target = {
    ...buildMatch("target", "a", "b", 0, 0),
    date: "2026-06-08T12:00:00Z"
  };
  const config = {
    ...defaultModelConfig,
    restDaysWeight: 0.12
  };
  const withoutRest = predictMatch(target, sampleTeams, config, [target]);
  const withRest = predictMatch(target, sampleTeams, config, [previousA, previousB, target]);
  const restFactor = withRest.factors.find((factor) => factor.label === "赛程休息");

  assert.equal(calculateTeamRestDays(target, "a", [previousA, previousB, target]), 7);
  assert.equal(calculateTeamRestDays(target, "b", [previousA, previousB, target]), 4);
  assert.ok(withRest.lambdaHome > withoutRest.lambdaHome);
  assert.ok(withRest.lambdaAway < withoutRest.lambdaAway);
  assert.ok(restFactor);
  assert.ok(restFactor.impact > 0);
});

test("双方都短休时会同时压低预期进球", () => {
  const sampleTeams = [
    buildTeam("a", 1800),
    buildTeam("b", 1800),
    buildTeam("c", 1700),
    buildTeam("d", 1700)
  ];
  const previousA = {
    ...buildMatch("prev-a", "a", "c", 1, 0),
    date: "2026-06-06T12:00:00Z"
  };
  const previousB = {
    ...buildMatch("prev-b", "b", "d", 1, 0),
    date: "2026-06-06T12:00:00Z"
  };
  const target = {
    ...buildMatch("target", "a", "b", 0, 0),
    date: "2026-06-08T12:00:00Z"
  };
  const config = {
    ...defaultModelConfig,
    restDaysWeight: 0.12
  };
  const withoutRest = predictMatch(target, sampleTeams, config, [target]);
  const withShortRest = predictMatch(target, sampleTeams, config, [
    previousA,
    previousB,
    target
  ]);
  const restFactor = withShortRest.factors.find((factor) => factor.label === "赛程休息");

  assert.equal(calculateTeamRestDays(target, "a", [previousA, previousB, target]), 2);
  assert.equal(calculateTeamRestDays(target, "b", [previousA, previousB, target]), 2);
  assert.ok(withShortRest.lambdaHome < withoutRest.lambdaHome);
  assert.ok(withShortRest.lambdaAway < withoutRest.lambdaAway);
  assert.ok(restFactor.description.includes("-0."));
});

test("小组积分排序使用积分、相互战绩和整体指标", () => {
  const sampleTeams = [
    buildTeam("a", 2000),
    buildTeam("b", 1900),
    buildTeam("c", 1800),
    buildTeam("d", 1700)
  ];
  const matches = [
    buildMatch("1", "a", "b", 2, 0),
    buildMatch("2", "c", "d", 1, 1),
    buildMatch("3", "b", "c", 5, 1)
  ];

  const standings = calculateActualGroupStandings(matches, sampleTeams);

  assert.equal(standings[0].teamId, "a");
  assert.equal(standings[0].points, 3);
  assert.equal(standings[1].teamId, "b");
  assert.equal(standings[1].goalDifference, 2);
});

test("小组排名会在同分时优先使用相互战绩", () => {
  const sampleTeams = [
    buildTeam("a", 2000),
    buildTeam("b", 1900),
    buildTeam("c", 1800),
    buildTeam("d", 1700)
  ];
  const matches = [
    buildMatch("1", "a", "b", 1, 0),
    buildMatch("2", "a", "c", 0, 3),
    buildMatch("3", "b", "c", 2, 0),
    buildMatch("4", "a", "d", 5, 0),
    buildMatch("5", "b", "d", 1, 0),
    buildMatch("6", "c", "d", 1, 0)
  ];

  const standings = calculateActualGroupStandings(matches, sampleTeams);

  assert.equal(standings[0].teamId, "c");
  assert.equal(standings[1].teamId, "b");
  assert.equal(standings[2].teamId, "a");
  assert.ok(standings.find((standing) => standing.teamId === "a").goalDifference >
    standings.find((standing) => standing.teamId === "c").goalDifference);
});

test("小组排名规则会明确标记未接入的 FIFA 细则", () => {
  const fairPlay = groupTieBreakerSteps.find((step) => step.id === "fair-play");
  const drawingLots = groupTieBreakerSteps.find((step) => step.id === "drawing-lots");

  assert.equal(groupTieBreakerSteps[0].id, "points");
  assert.equal(groupTieBreakerSteps[1].id, "head-to-head");
  assert.equal(fairPlay.status, "implemented");
  assert.equal(drawingLots.status, "placeholder");
});

test("公平竞赛分会按纪律记录扣分并参与同分排序", () => {
  const sampleTeams = [
    buildTeam("a", 2000),
    buildTeam("b", 1900),
    buildTeam("c", 1800),
    buildTeam("d", 1700)
  ];
  const matches = [
    buildMatch("1", "a", "b", 0, 0),
    buildMatch("2", "a", "c", 1, 0),
    buildMatch("3", "b", "c", 1, 0),
    buildMatch("4", "a", "d", 0, 0),
    buildMatch("5", "b", "d", 0, 0),
    buildMatch("6", "c", "d", 1, 0)
  ];
  matches[0].discipline = {
    home: { yellowCards: 2 },
    away: { yellowCards: 1 }
  };
  const standings = calculateActualGroupStandings(matches, sampleTeams);

  assert.equal(calculateFairPlayPoints({
    yellowCards: 1,
    secondYellowReds: 1,
    directRedCards: 1,
    yellowThenDirectReds: 1
  }), -13);
  assert.equal(standings[0].teamId, "b");
  assert.equal(standings[1].teamId, "a");
  assert.equal(standings[0].fairPlayPoints, -1);
  assert.equal(standings[1].fairPlayPoints, -2);
});

test("小组纪律扣分会转成淘汰赛停赛风险负荷", () => {
  const sampleTeams = [buildTeam("a", 1900), buildTeam("b", 1800)];
  const standingsByGroup = new Map([
    [
      "A",
      [
        {
          ...buildQualified("a", "A", 1).standing,
          fairPlayPoints: -8
        },
        {
          ...buildQualified("b", "A", 2).standing,
          fairPlayPoints: -2
        }
      ]
    ]
  ]);
  const adjustedTeams = applyKnockoutSuspensionRisk(sampleTeams, standingsByGroup, {
    ...defaultModelConfig,
    suspensionRiskWeight: 0.04
  });
  const adjustedA = adjustedTeams.find((team) => team.id === "a");
  const adjustedB = adjustedTeams.find((team) => team.id === "b");

  assert.equal(calculateSuspensionLoad(-2, 0.04), 0);
  assert.ok(calculateSuspensionLoad(-8, 0.04) > 0);
  assert.ok(adjustedA.injuries > sampleTeams[0].injuries);
  assert.ok(adjustedA.form < sampleTeams[0].form);
  assert.equal(adjustedB.injuries, sampleTeams[1].injuries);
});

test("当前快照包含完整小组赛和已完赛比分", () => {
  assert.equal(currentTournamentSnapshot.fixtures.length, 72);
  assert.equal(currentTournamentSnapshot.completedMatches, 28);

  const mexico = teams.find((team) => team.abbr === "MEX");
  const southAfrica = teams.find((team) => team.abbr === "RSA");
  const germany = teams.find((team) => team.abbr === "GER");
  const curacao = teams.find((team) => team.abbr === "CUW");
  const england = teams.find((team) => team.abbr === "ENG");
  const croatia = teams.find((team) => team.abbr === "CRO");
  const uzbekistan = teams.find((team) => team.abbr === "UZB");
  const colombia = teams.find((team) => team.abbr === "COL");
  const opener = fixtures.find(
    (match) => match.homeTeamId === mexico.id && match.awayTeamId === southAfrica.id
  );
  const germanyOpener = fixtures.find(
    (match) => match.homeTeamId === germany.id && match.awayTeamId === curacao.id
  );
  const englandOpener = fixtures.find(
    (match) => match.homeTeamId === england.id && match.awayTeamId === croatia.id
  );
  const colombiaOpener = fixtures.find(
    (match) => match.homeTeamId === uzbekistan.id && match.awayTeamId === colombia.id
  );

  assert.deepEqual(opener.result, { homeGoals: 2, awayGoals: 0 });
  assert.equal(opener.status, "completed");
  assert.deepEqual(germanyOpener.result, { homeGoals: 7, awayGoals: 1 });
  assert.equal(germanyOpener.status, "completed");
  assert.deepEqual(englandOpener.result, { homeGoals: 4, awayGoals: 2 });
  assert.equal(englandOpener.status, "completed");
  assert.deepEqual(colombiaOpener.result, { homeGoals: 1, awayGoals: 3 });
  assert.equal(colombiaOpener.status, "completed");
});

test("数据质量检查识别完整快照且保留动态数据警告", () => {
  const checks = validateTournamentSnapshot(currentTournamentSnapshot);
  const failures = checks.filter((check) => check.level === "fail");
  const dynamicFeeds = checks.find((check) => check.id === "dynamic-feeds");

  assert.equal(failures.length, 0);
  assert.ok(dynamicFeeds);
  assert.equal(dynamicFeeds.level, "warn");
});

test("本地数据适配器返回赛程排名和动态占位流", async () => {
  const report = await snapshotAdapter.refreshAll();
  const fixturesFeed = report.feeds.find((feed) => feed.kind === "fixtures");
  const oddsFeed = report.feeds.find((feed) => feed.kind === "odds");

  assert.equal(report.qualityChecks.some((check) => check.level === "fail"), false);
  assert.equal(fixturesFeed.records, 72);
  assert.equal(fixturesFeed.status, "ready");
  assert.equal(oddsFeed.status, "planned");
});

test("JSON 赛果导入会更新运行态快照并重算完赛数", () => {
  const target = fixtures.find((fixture) => fixture.status !== "completed");
  const result = importTournamentJson(
    JSON.stringify({
      results: [
        {
          matchId: target.id,
          homeGoals: 1,
          awayGoals: 0
        }
      ]
    }),
    currentTournamentSnapshot
  );
  const importedMatch = result.snapshot.fixtures.find((fixture) => fixture.id === target.id);

  assert.equal(result.summary.importedResults, 1);
  assert.equal(importedMatch.status, "completed");
  assert.deepEqual(importedMatch.result, { homeGoals: 1, awayGoals: 0 });
  assert.equal(result.snapshot.completedMatches, currentTournamentSnapshot.completedMatches + 1);
});

test("JSON 赛果导入会更新比赛纪律数据并影响公平竞赛分", () => {
  const target = fixtures.find((fixture) => fixture.status !== "completed");
  const result = importTournamentJson(
    JSON.stringify({
      results: [
        {
          matchId: target.id,
          homeGoals: 0,
          awayGoals: 0,
          discipline: {
            home: { yellowCards: 2 },
            away: { yellowCards: 1, directRedCards: 1 }
          }
        }
      ]
    }),
    currentTournamentSnapshot
  );
  const importedMatch = result.snapshot.fixtures.find((fixture) => fixture.id === target.id);
  const homeStanding = calculateActualGroupStandings(
    [importedMatch],
    result.snapshot.teams
  ).find((standing) => standing.teamId === importedMatch.homeTeamId);
  const awayStanding = calculateActualGroupStandings(
    [importedMatch],
    result.snapshot.teams
  ).find((standing) => standing.teamId === importedMatch.awayTeamId);

  assert.equal(result.summary.importedDiscipline, 1);
  assert.deepEqual(importedMatch.discipline.home, { yellowCards: 2 });
  assert.equal(homeStanding.fairPlayPoints, -2);
  assert.equal(awayStanding.fairPlayPoints, -5);
});

test("JSON 导入会拒绝无法识别的数据", () => {
  assert.throws(
    () => importTournamentJson(JSON.stringify({ foo: "bar" }), currentTournamentSnapshot),
    /没有可导入/
  );
  assert.throws(
    () => importTournamentJson("{bad json", currentTournamentSnapshot),
    /JSON 格式无效/
  );
});

test("JSON 球队补丁导入会更新排名状态和伤停字段", () => {
  const result = importTournamentJson(
    JSON.stringify({
      teamPatches: [
        {
          id: "mex",
          fifaRank: 14,
          injuries: 0.12,
          form: 0.2
        }
      ]
    }),
    currentTournamentSnapshot
  );
  const mexico = result.snapshot.teams.find((team) => team.id === "mex");

  assert.equal(result.summary.importedTeams, 1);
  assert.equal(mexico.fifaRank, 14);
  assert.equal(mexico.injuries, 0.12);
  assert.equal(mexico.form, 0.2);
});

test("JSON 导入预检会列出比赛和球队字段变化", () => {
  const target = fixtures.find((fixture) => fixture.status !== "completed");
  const preview = previewTournamentImport(
    JSON.stringify({
      results: [
        {
          matchId: target.id,
          homeGoals: 1,
          awayGoals: 0
        }
      ],
      teamPatches: [
        {
          id: "mex",
          injuries: 0.12,
          form: 0.2
        }
      ]
    }),
    currentTournamentSnapshot
  );
  const fixtureChange = preview.fixtureChanges.find((change) => change.id === target.id);
  const teamChange = preview.teamChanges.find((change) => change.id === "mex");

  assert.equal(preview.summary.importedResults, 1);
  assert.ok(fixtureChange.fields.some((field) => field.field === "result" && field.after === "1-0"));
  assert.ok(fixtureChange.fields.some((field) => field.field === "status" && field.after === "completed"));
  assert.ok(teamChange.fields.some((field) => field.field === "form" && field.after === "0.200"));
  assert.ok(teamChange.fields.some((field) => field.field === "injuries" && field.after === "0.120"));
});

test("导入模型影响预估会比较球队冠军概率和比赛胜平负", () => {
  const targetMatch = fixtures.find((fixture) => fixture.homeTeamId === "mex");
  const nextSnapshot = importTournamentJson(
    JSON.stringify({
      teamPatches: [
        {
          id: "mex",
          form: 0.25,
          attack: 1.25,
          injuries: 0.03
        }
      ]
    }),
    currentTournamentSnapshot
  ).snapshot;
  const impact = buildImportModelImpact(currentTournamentSnapshot, nextSnapshot, defaultModelConfig, {
    iterations: 300,
    seed: 1234,
    selectedMatchId: targetMatch.id
  });
  const mexicoImpact = impact.teamImpacts.find((item) => item.teamId === "mex");
  const matchImpact = impact.matchImpacts.find((item) => item.matchId === targetMatch.id);

  assert.equal(impact.iterations, 300);
  assert.ok(mexicoImpact);
  assert.ok(mexicoImpact.afterChampion >= mexicoImpact.beforeChampion);
  assert.ok(matchImpact);
  assert.ok(matchImpact.after.homeWin > matchImpact.before.homeWin);
});

test("模型回测会基于已完赛比赛计算校准指标", () => {
  const evaluation = evaluateCompletedMatches(fixtures, teams, defaultModelConfig);

  assert.equal(evaluation.completedMatches, currentTournamentSnapshot.completedMatches);
  assert.equal(evaluation.sampleQuality, "usable");
  assert.ok(evaluation.averageBrier >= 0);
  assert.ok(evaluation.averageLogLoss > 0);
  assert.ok(evaluation.averageGoalError >= 0);
  assert.ok(evaluation.winnerAccuracy >= 0 && evaluation.winnerAccuracy <= 1);
  assert.equal(evaluation.matches.length, currentTournamentSnapshot.completedMatches);
  assert.ok(
    evaluation.matches.every(
      (match) => match.actualProbability > 0 && match.actualProbability <= 1
    )
  );
});

test("模型回测在没有赛果时返回空样本状态", () => {
  const scheduledFixtures = fixtures.map((fixture) => ({
    ...fixture,
    result: undefined,
    status: "scheduled"
  }));
  const evaluation = evaluateCompletedMatches(scheduledFixtures, teams, defaultModelConfig);

  assert.equal(evaluation.completedMatches, 0);
  assert.equal(evaluation.sampleQuality, "empty");
  assert.equal(evaluation.averageBrier, 0);
  assert.equal(evaluation.matches.length, 0);
});

test("模型预设回测会按损失排序并保留当前参数对比", () => {
  const calibration = compareModelConfigurations(fixtures, teams, defaultModelConfig);
  const current = calibration.candidates.find((candidate) => candidate.isCurrent);

  assert.equal(calibration.completedMatches, currentTournamentSnapshot.completedMatches);
  assert.equal(calibration.candidates.length, modelPresets.length + 1);
  assert.equal(calibration.bestCandidate.rank, 1);
  assert.ok(current);
  assert.equal(current.id, "current");
  assert.equal(current.logLossDelta, 0);
  assert.equal(current.brierDelta, 0);

  for (let index = 1; index < calibration.candidates.length; index += 1) {
    const previous = calibration.candidates[index - 1];
    const next = calibration.candidates[index];

    assert.ok(previous.evaluation.averageLogLoss <= next.evaluation.averageLogLoss);
  }
});

test("模型预设回测会识别可一键应用的推荐预设", () => {
  const degradedConfig = {
    ...defaultModelConfig,
    baseGoals: 4.8,
    eloWeight: 0,
    rankWeight: 0,
    formWeight: 0,
    injuryWeight: 0,
    dixonColesRho: 0
  };
  const calibration = compareModelConfigurations(fixtures, teams, degradedConfig, [
    {
      id: "balanced",
      presetId: "balanced",
      label: "均衡模型",
      description: "测试候选预设",
      config: defaultModelConfig
    }
  ]);
  const current = calibration.candidates.find((candidate) => candidate.isCurrent);

  assert.equal(calibration.bestCandidate.id, "balanced");
  assert.equal(calibration.bestCandidate.presetId, "balanced");
  assert.equal(calibration.bestCandidate.canApply, true);
  assert.equal(calibration.recommendation.status, "apply");
  assert.equal(current.canApply, false);
});

test("模型预设回测在样本不足时只建议观察", () => {
  const degradedConfig = {
    ...defaultModelConfig,
    baseGoals: 4.8,
    eloWeight: 0,
    rankWeight: 0,
    formWeight: 0,
    injuryWeight: 0,
    dixonColesRho: 0
  };
  const limitedFixtures = fixtures
    .filter((fixture) => fixture.status === "completed")
    .slice(0, 8);
  const calibration = compareModelConfigurations(limitedFixtures, teams, degradedConfig, [
    {
      id: "balanced",
      presetId: "balanced",
      label: "均衡模型",
      description: "测试候选预设",
      config: defaultModelConfig
    }
  ]);

  assert.equal(calibration.sampleQuality, "limited");
  assert.equal(calibration.bestCandidate.id, "balanced");
  assert.equal(calibration.bestCandidate.canApply, false);
  assert.equal(calibration.recommendation.status, "observe");
});

test("模型参数可以保存、恢复、清空和 JSON 导入导出", () => {
  const storage = createMemoryStorage();
  const customConfig = {
    ...defaultModelConfig,
    eloWeight: defaultModelConfig.eloWeight + 0.15,
    simulationIterations: 5000
  };
  const savedAt = saveModelConfig(customConfig, storage);
  const loaded = loadModelConfig(defaultModelConfig, storage);
  const exported = serializeModelConfig(customConfig);
  const imported = parseModelConfigImport(exported);

  assert.ok(savedAt);
  assert.equal(loaded.restored, true);
  assert.equal(loaded.config.eloWeight, customConfig.eloWeight);
  assert.equal(imported.simulationIterations, 5000);

  clearModelConfig(storage);
  assert.equal(loadModelConfig(defaultModelConfig, storage).restored, false);
  assert.throws(() => parseModelConfigImport("{bad json"), /JSON 格式无效/);
});

test("旧模型参数导入会用默认值补齐新增字段", () => {
  const imported = parseModelConfigImport(
    JSON.stringify({
      eloWeight: 1.1,
      rankWeight: 0.6,
      formWeight: 0.5,
      injuryWeight: 0.4,
      hostBoost: 0.08,
      restDaysWeight: 0.03,
      dixonColesRho: -0.08,
      penaltyStrengthWeight: 0.6,
      simulationIterations: 5000
    })
  );

  assert.equal(imported.eloWeight, 1.1);
  assert.equal(imported.extraTimeGoalRate, defaultModelConfig.extraTimeGoalRate);
  assert.equal(imported.suspensionRiskWeight, defaultModelConfig.suspensionRiskWeight);
  assert.equal(imported.simulationIterations, 5000);
});

test("运行态快照可以保存、恢复、清空和序列化", () => {
  const storage = createMemoryStorage();
  const savedAt = saveRuntimeSnapshot(currentTournamentSnapshot, storage);
  const loaded = loadRuntimeSnapshot(currentTournamentSnapshot, storage);
  const serialized = serializeTournamentSnapshot(currentTournamentSnapshot);
  const filename = buildSnapshotFilename(currentTournamentSnapshot);

  assert.ok(savedAt);
  assert.equal(loaded.restored, true);
  assert.equal(loaded.snapshot.fixtures.length, 72);
  assert.equal(JSON.parse(serialized).id, currentTournamentSnapshot.id);
  assert.match(filename, /^world-cup-2026-snapshot-/);

  clearRuntimeSnapshot(storage);
  assert.equal(loadRuntimeSnapshot(currentTournamentSnapshot, storage).restored, false);
});

test("内置快照更新时会优先使用较新的内置数据", () => {
  const storage = createMemoryStorage();
  const oldSnapshot = {
    ...currentTournamentSnapshot,
    id: "world-cup-2026-verified-snapshot-2026-06-13-cn",
    collectedAt: "2026-06-13T06:00:00+08:00"
  };

  saveRuntimeSnapshot(oldSnapshot, storage);
  const loaded = loadRuntimeSnapshot(currentTournamentSnapshot, storage);

  assert.equal(loaded.restored, false);
  assert.equal(loaded.snapshot.id, currentTournamentSnapshot.id);
  assert.match(loaded.error ?? "", /内置快照已更新/);
});

test("导入历史会保存最近导入前快照并限制数量", () => {
  const storage = createMemoryStorage();

  for (let index = 0; index < 7; index += 1) {
    saveImportHistoryEntry(
      {
        id: `history-${index}`,
        createdAt: `2026-06-13T00:0${index}:00.000Z`,
        snapshot: currentTournamentSnapshot,
        summary: {
          appliedAt: `2026-06-13T00:0${index}:10.000Z`,
          importedFixtures: index,
          importedResults: index + 1,
          importedTeams: index + 2,
          label: `import-${index}`,
          warnings: []
        }
      },
      storage
    );
  }

  const history = loadImportHistory(storage);

  assert.equal(history.length, 5);
  assert.equal(history[0].id, "history-6");
  assert.equal(history.at(-1).id, "history-2");
  assert.equal(history[0].snapshot.fixtures.length, 72);

  clearImportHistory(storage);
  assert.equal(loadImportHistory(storage).length, 0);
});

test("导入复盘历史会保存最近导入后摘要并限制数量", () => {
  const storage = createMemoryStorage();

  for (let index = 0; index < 10; index += 1) {
    saveImportRecapHistoryEntry(
      {
        id: `recap-${index}`,
        appliedAt: `2026-06-13T01:0${index}:00.000Z`,
        fixtureChanges: [
          {
            id: `m-${index}`,
            label: `fixture-${index}`,
            fields: [{ after: "2-0", before: "-", field: "result", label: "比分" }]
          }
        ],
        matchImpacts: [],
        sourceSnapshot: {
          collectedAt: currentTournamentSnapshot.collectedAt,
          id: currentTournamentSnapshot.id,
          label: currentTournamentSnapshot.label
        },
        sources: currentTournamentSnapshot.sources,
        summary: {
          appliedAt: `2026-06-13T01:0${index}:00.000Z`,
          importedFixtures: index,
          importedResults: index + 1,
          importedTeams: index + 2,
          label: `recap-import-${index}`,
          warnings: index % 2 === 0 ? [] : [`warning-${index}`]
        },
        teamChanges: [],
        teamImpacts: [
          {
            afterChampion: 0.2,
            afterRound16: 0.8,
            beforeChampion: 0.1,
            beforeRound16: 0.7,
            deltaChampion: 0.1,
            deltaRound16: 0.1,
            label: "Mexico (MEX)",
            teamId: "mex"
          }
        ],
        warnings: index % 2 === 0 ? [] : [`warning-${index}`]
      },
      storage
    );
  }

  const history = loadImportRecapHistory(storage);

  assert.equal(history.length, 8);
  assert.equal(history[0].id, "recap-9");
  assert.equal(history.at(-1).id, "recap-2");
  assert.equal(history[0].teamImpacts[0].teamId, "mex");
  assert.equal(history[0].fixtureChanges[0].fields[0].field, "result");

  clearImportRecapHistory(storage);
  assert.equal(loadImportRecapHistory(storage).length, 0);
});

test("导入预检到历史回滚链路会恢复导入前预测状态", () => {
  const storage = createMemoryStorage();
  const targetMatch = fixtures.find(
    (fixture) =>
      (fixture.homeTeamId === "mex" || fixture.awayTeamId === "mex") &&
      fixture.status !== "completed"
  );
  const mexicoBefore = currentTournamentSnapshot.teams.find((team) => team.id === "mex");
  const importText = JSON.stringify({
    label: "workflow smoke import",
    teamPatches: [
      {
        id: "mex",
        attack: mexicoBefore.attack + 0.18,
        form: 0.32,
        injuries: 0.01
      }
    ],
    results: [
      {
        matchId: targetMatch.id,
        homeGoals: 3,
        awayGoals: 0
      }
    ]
  });
  const preview = previewTournamentImport(importText, currentTournamentSnapshot);
  const beforePrediction = predictMatch(targetMatch, currentTournamentSnapshot.teams, defaultModelConfig);
  const afterMatch = preview.snapshot.fixtures.find((fixture) => fixture.id === targetMatch.id);
  const afterPrediction = predictMatch(afterMatch, preview.snapshot.teams, defaultModelConfig);

  saveImportHistoryEntry(
    {
      id: "workflow-before-import",
      createdAt: "2026-06-13T08:00:00.000Z",
      snapshot: currentTournamentSnapshot,
      summary: preview.summary
    },
    storage
  );
  saveRuntimeSnapshot(preview.snapshot, storage);

  const loadedAfterImport = loadRuntimeSnapshot(currentTournamentSnapshot, storage);
  const importedMexico = loadedAfterImport.snapshot.teams.find((team) => team.id === "mex");
  const importedMatch = loadedAfterImport.snapshot.fixtures.find(
    (fixture) => fixture.id === targetMatch.id
  );
  const rollbackSnapshot = loadImportHistory(storage)[0].snapshot;

  saveRuntimeSnapshot(rollbackSnapshot, storage);
  const loadedAfterRollback = loadRuntimeSnapshot(preview.snapshot, storage);
  const restoredMexico = loadedAfterRollback.snapshot.teams.find((team) => team.id === "mex");
  const restoredMatch = loadedAfterRollback.snapshot.fixtures.find(
    (fixture) => fixture.id === targetMatch.id
  );
  const rollbackPrediction = predictMatch(
    restoredMatch,
    loadedAfterRollback.snapshot.teams,
    defaultModelConfig
  );

  assert.equal(preview.summary.importedTeams, 1);
  assert.equal(preview.summary.importedResults, 1);
  assert.equal(loadedAfterImport.restored, true);
  assert.equal(importedMexico.form, 0.32);
  assert.deepEqual(importedMatch.result, { homeGoals: 3, awayGoals: 0 });
  const mexicoWinKey = targetMatch.homeTeamId === "mex" ? "homeWin" : "awayWin";
  assert.ok(afterPrediction[mexicoWinKey] > beforePrediction[mexicoWinKey]);
  assert.equal(loadedAfterRollback.restored, true);
  assert.equal(restoredMexico.form, mexicoBefore.form);
  assert.equal(restoredMatch.result, targetMatch.result);
  assert.equal(rollbackPrediction[mexicoWinKey], beforePrediction[mexicoWinKey]);
});

test("导入模板会生成可用的赛果和赛程 JSON", () => {
  const target = fixtures.find((fixture) => fixture.status !== "completed");
  const resultTemplate = JSON.parse(buildResultImportTemplate(target));
  const fixtureTemplate = JSON.parse(buildFixturePatchTemplate(target));
  const bulkTemplate = JSON.parse(buildBulkResultsTemplate(currentTournamentSnapshot, 2));
  const combinedTemplate = JSON.parse(buildCombinedDataPackageTemplate(currentTournamentSnapshot));

  assert.equal(resultTemplate.results[0].matchId, target.id);
  assert.equal(fixtureTemplate.fixtures[0].id, target.id);
  assert.equal(bulkTemplate.results.length, 2);
  assert.ok(bulkTemplate.results.every((item) => typeof item.matchId === "string"));
  assert.equal(combinedTemplate.label, "Daily model input");
  assert.equal(combinedTemplate.teamPatches.length, 3);
  assert.ok(combinedTemplate.teamPatches.every((item) => typeof item.abbr === "string"));
});

test("比赛 ID 辅助会按小组输出当前赛程", () => {
  const helpers = buildFixtureImportHelpers(currentTournamentSnapshot, "A");

  assert.equal(helpers.length, 6);
  assert.ok(helpers.every((helper) => helper.group === "A"));
  assert.ok(helpers.some((helper) => helper.id === "A-1-1" && helper.score === "2-0"));
});

test("预计小组表会把真实赛果计入积分", async () => {
  const { predictMatch } = await import("../src/model/predict.ts");
  const { calculateGroupStandings } = await import("../src/model/standings.ts");
  const predictions = fixtures.map((match) => predictMatch(match, teams, defaultModelConfig));
  const standings = calculateGroupStandings(fixtures, predictions, teams);
  const mexico = teams.find((team) => team.abbr === "MEX");
  const mexicoStanding = standings.find((standing) => standing.teamId === mexico.id);

  assert.ok(mexicoStanding.points >= 3);
  assert.ok(mexicoStanding.goalDifference >= 2);
});

test("固定随机种子的蒙特卡洛结果可复现", () => {
  const one = simulateTournament(fixtures, teams, defaultModelConfig, 500, 42);
  const two = simulateTournament(fixtures, teams, defaultModelConfig, 500, 42);

  assert.deepEqual(one.teams.slice(0, 5), two.teams.slice(0, 5));
});

test("单场预测缓存会跨模拟复用并区分模型参数", () => {
  clearPredictionCache();
  assert.equal(getPredictionCacheSize(), 0);

  simulateTournament(fixtures, teams, defaultModelConfig, 20, 101);
  const firstSize = getPredictionCacheSize();
  simulateTournament(fixtures, teams, defaultModelConfig, 20, 101);
  const reusedSize = getPredictionCacheSize();
  simulateTournament(
    fixtures,
    teams,
    {
      ...defaultModelConfig,
      baseGoals: defaultModelConfig.baseGoals + 0.04
    },
    20,
    103
  );
  const changedConfigSize = getPredictionCacheSize();

  assert.ok(firstSize > 0);
  assert.equal(reusedSize, firstSize);
  assert.ok(changedConfigSize > reusedSize);

  clearPredictionCache();
});

test("Wilson 置信区间会包住样本比例且保持在 0 到 1", () => {
  const interval = getWilsonInterval(32, 200);
  const proportion = 32 / 200;
  const noTrialInterval = getWilsonInterval(0, 0);

  assert.ok(interval.low <= proportion);
  assert.ok(interval.high >= proportion);
  assert.ok(interval.low >= 0);
  assert.ok(interval.high <= 1);
  assert.deepEqual(noTrialInterval, { low: 0, high: 0 });
});

test("带进度回调的蒙特卡洛结果与原模拟保持一致", () => {
  const progressEvents = [];
  const baseline = simulateTournament(fixtures, teams, defaultModelConfig, 120, 2026);
  const withProgress = simulateTournamentWithProgress(fixtures, teams, defaultModelConfig, {
    iterations: 120,
    seed: 2026,
    progressStep: 30,
    onProgress: (event) => progressEvents.push(event)
  });

  assert.deepEqual(withProgress.teams, baseline.teams);
  assert.deepEqual(withProgress.bracketPreview, baseline.bracketPreview);
  assert.equal(progressEvents.length, 4);
  assert.equal(progressEvents[0].completedIterations, 30);
  assert.equal(progressEvents.at(-1).completedIterations, 120);
  assert.equal(progressEvents.at(-1).progress, 1);
});

const groupLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

test("淘汰赛规则适配层默认使用 FIFA 官方对位结构并满足资格约束", () => {
  const qualified = {
    firsts: groupLetters.map((group) => buildQualified(`1${group}`, group, 1)),
    seconds: groupLetters.map((group) => buildQualified(`2${group}`, group, 2)),
    bestThirds: ["C", "D", "F", "G", "H", "I", "J", "K"].map((group) =>
      buildQualified(`3${group}`, group, 3)
    )
  };
  const pairs = buildRoundOf32Pairs(qualified);

  assert.equal(activeKnockoutRuleSet.id, "fifa-2026-official-bracket");
  assert.equal(activeKnockoutRuleSet.source, "official");
  assert.equal(pairs.length, 16);

  const byTeamIds = pairs.map(([home, away]) => `${home.teamId}-${away.teamId}`);
  assert.ok(byTeamIds.includes("2A-2B"));
  assert.ok(byTeamIds.includes("1C-2F"));
  assert.ok(byTeamIds.includes("1F-2C"));
  assert.ok(byTeamIds.includes("2D-2G"));

  const groupOfThirdPlaceOpponent = pairs
    .filter(([home]) => home.teamId.startsWith("1"))
    .map(([, away]) => away)
    .filter((away) => away.teamId.startsWith("3"));
  assert.equal(groupOfThirdPlaceOpponent.length, 8);
  assert.deepEqual(
    new Set(groupOfThirdPlaceOpponent.map((team) => team.group)),
    new Set(["C", "D", "F", "G", "H", "I", "J", "K"])
  );
});

test("官方对位结构在数据不完整时会降级回 MVP 占位对位", () => {
  const qualified = {
    firsts: Array.from({ length: 12 }, (_, index) => buildQualified(`1${index}`, "A", 1)),
    seconds: Array.from({ length: 12 }, (_, index) => buildQualified(`2${index}`, "B", 2)),
    bestThirds: Array.from({ length: 8 }, (_, index) => buildQualified(`3${index}`, "C", 3))
  };
  const pairs = buildRoundOf32Pairs(qualified, mvpSeededKnockoutRuleSet);

  assert.equal(mvpSeededKnockoutRuleSet.source, "placeholder");
  assert.equal(pairs.length, 16);
  assert.deepEqual(
    pairs.map(([home, away]) => `${home.teamId}-${away.teamId}`).slice(0, 4),
    ["10-37", "11-36", "12-35", "13-34"]
  );
  assert.deepEqual(
    pairs.map(([home, away]) => `${home.teamId}-${away.teamId}`).slice(-4),
    ["20-21", "22-23", "24-25", "26-27"]
  );

  const officialFallbackPairs = buildRoundOf32Pairs(qualified);
  assert.equal(officialFallbackPairs.length, 16);
});

test("官方对位结构对全部 495 种最佳第三名组合都能求出合法匹配", () => {
  function combinations(arr, k) {
    const results = [];
    function helper(start, combo) {
      if (combo.length === k) {
        results.push([...combo]);
        return;
      }
      for (let i = start; i < arr.length; i += 1) {
        combo.push(arr[i]);
        helper(i + 1, combo);
        combo.pop();
      }
    }
    helper(0, []);
    return results;
  }

  const allCombinations = combinations(groupLetters, 8);
  assert.equal(allCombinations.length, 495);

  let fallbackCount = 0;
  for (const thirdGroups of allCombinations) {
    const qualified = {
      firsts: groupLetters.map((group) => buildQualified(`1${group}`, group, 1)),
      seconds: groupLetters.map((group) => buildQualified(`2${group}`, group, 2)),
      bestThirds: thirdGroups.map((group) => buildQualified(`3${group}`, group, 3))
    };
    const pairs = buildRoundOf32Pairs(qualified);
    const thirdOpponents = pairs.flat().filter((team) => team.teamId.startsWith("3"));
    if (new Set(thirdOpponents.map((team) => team.teamId)).size !== 8) {
      fallbackCount += 1;
    }
  }

  assert.equal(fallbackCount, 0);
});

test("模拟 Worker 请求和进度消息结构稳定", () => {
  const request = buildSimulationWorkerRequest({
    requestId: 12,
    fixtures: fixtures.slice(0, 2),
    teams: teams.slice(0, 4),
    config: defaultModelConfig,
    iterations: 1000,
    seed: 77
  });
  const progress = buildSimulationWorkerProgress({
    requestId: request.requestId,
    completedIterations: 260,
    totalIterations: 1000,
    elapsedMs: 18
  });

  assert.equal(request.type, "simulate");
  assert.equal(request.progressStep, getSimulationProgressStep(1000));
  assert.equal(request.progressStep, 25);
  assert.equal(isSimulationWorkerRequest(request), true);
  assert.equal(isSimulationWorkerRequest({ type: "simulate" }), false);
  assert.equal(progress.type, "progress");
  assert.equal(progress.progress, 0.26);
  assert.equal(progress.elapsedMs, 18);
});

test("淘汰赛常规时间平局会先模拟加时赛", () => {
  const sampleTeams = [buildTeam("a", 1900), buildTeam("b", 1800)];
  const prediction = {
    matchId: "knockout-test",
    homeTeamId: "a",
    awayTeamId: "b",
    lambdaHome: 6,
    lambdaAway: 0.01,
    homeWin: 0,
    draw: 1,
    awayWin: 0,
    scoreMatrix: [{ homeGoals: 0, awayGoals: 0, probability: 1 }],
    topScores: [{ homeGoals: 0, awayGoals: 0, probability: 1 }],
    factors: [],
    confidence: 0.5
  };
  const randomValues = [0.5, 0.99];
  const decision = resolveKnockoutWinner(
    "a",
    "b",
    prediction,
    sampleTeams,
    {
      ...defaultModelConfig,
      extraTimeGoalRate: 1
    },
    () => randomValues.shift() ?? 0.99
  );

  assert.equal(decision.decidedBy, "extra-time");
  assert.equal(decision.winnerTeamId, "a");
  assert.ok(decision.extraTimeScore.homeGoals > decision.extraTimeScore.awayGoals);
});

test("各轮晋级概率保持单调", () => {
  const simulation = simulateTournament(fixtures, teams, defaultModelConfig, 500, 7);

  for (const team of simulation.teams) {
    assert.ok(team.round32 >= team.round16);
    assert.ok(team.round16 >= team.quarterFinal);
    assert.ok(team.quarterFinal >= team.semiFinal);
    assert.ok(team.semiFinal >= team.final);
    assert.ok(team.final >= team.champion);
  }
});

test("冠军概率总和接近 1 且落在各自置信区间内", () => {
  const simulation = simulateTournament(fixtures, teams, defaultModelConfig, 500, 17);
  const championTotal = simulation.teams.reduce((sum, team) => sum + team.champion, 0);

  assert.ok(Math.abs(championTotal - 1) < 1e-8);
  for (const team of simulation.teams) {
    assert.ok(team.championCiLow <= team.champion);
    assert.ok(team.championCiHigh >= team.champion);
    assert.ok(team.championCiLow >= 0);
    assert.ok(team.championCiHigh <= 1);
  }
});

test("模拟结果可以导出为 CSV 和 JSON", () => {
  const simulation = simulateTournament(fixtures, teams, defaultModelConfig, 100, 33);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const csv = serializeSimulationCsv(simulation, teamsById);
  const json = JSON.parse(
    serializeSimulationJson(simulation, teamsById, {
      modelConfig: defaultModelConfig,
      snapshot: currentTournamentSnapshot
    })
  );
  const audit = buildSimulationAuditSummary(simulation, {
    exportedAt: "2026-06-13T00:00:00.000Z",
    modelConfig: defaultModelConfig,
    snapshot: currentTournamentSnapshot
  });
  const filename = buildSimulationExportFilename(simulation, "csv");

  assert.match(csv.split("\n")[0], /team_id,team_name,abbr/);
  assert.ok(csv.includes("champion_probability"));
  assert.equal(json.iterations, 100);
  assert.equal(json.audit.snapshotId, currentTournamentSnapshot.id);
  assert.equal(json.audit.modelConfig.simulationIterations, defaultModelConfig.simulationIterations);
  assert.equal(json.audit.knockoutRuleSet.source, "official");
  assert.equal(json.teams.length, teams.length);
  assert.ok(json.teams[0].champion >= 0);
  assert.equal(audit.exportedAt, "2026-06-13T00:00:00.000Z");
  assert.equal(audit.dataSources.length, currentTournamentSnapshot.sources.length);
  assert.match(filename, /^world-cup-2026-simulation-.*\.csv$/);
});

test("模拟结果可以导出分享 SVG 卡片", () => {
  const simulation = simulateTournament(fixtures, teams, defaultModelConfig, 100, 34);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const svg = serializeSimulationShareSvg(simulation, teamsById, {
    exportedAt: "2026-06-15T00:00:00.000Z",
    modelConfig: defaultModelConfig,
    snapshot: currentTournamentSnapshot
  });
  const filename = buildSimulationShareFilename(simulation);
  const topTeam = teamsById.get(simulation.teams[0].teamId);

  assert.match(svg, /^<svg /);
  assert.ok(svg.includes("冠军概率 Top 5"));
  assert.ok(svg.includes("Monte Carlo 100 次"));
  assert.ok(svg.includes(topTeam.name));
  assert.ok(svg.includes("加时赛/点球/停赛风险修正"));
  assert.match(filename, /^world-cup-2026-share-card-.*\.svg$/);
});

test("显著提高球队实力会提升夺冠概率", () => {
  const boostedTeams = teams.map((team) =>
    team.id === "mex"
      ? {
          ...team,
          elo: team.elo + 420,
          attack: team.attack + 0.3,
          defense: team.defense + 0.2
        }
      : team
  );
  const base = simulateTournament(fixtures, teams, defaultModelConfig, 500, 99);
  const boosted = simulateTournament(fixtures, boostedTeams, defaultModelConfig, 500, 99);
  const baseMexico = base.teams.find((team) => team.teamId === "mex");
  const boostedMexico = boosted.teams.find((team) => team.teamId === "mex");

  assert.ok(boostedMexico.champion > baseMexico.champion);
});

test("小组难度指数会随整体实力和竞争接近度上升", () => {
  const hardTeams = [
    buildTeam("a", 1900),
    buildTeam("b", 1840),
    buildTeam("c", 1780),
    buildTeam("d", 1720)
  ].map((team, index) => ({ ...team, fifaRank: index + 4 }));
  const openTeams = [
    buildTeam("e", 1760),
    buildTeam("f", 1580),
    buildTeam("g", 1450),
    buildTeam("h", 1360)
  ].map((team, index) => ({ ...team, fifaRank: 18 + index * 18 }));
  const hard = calculateGroupDifficulty("A", hardTeams, [
    buildSimulationSummary("a", 0.82),
    buildSimulationSummary("b", 0.75),
    buildSimulationSummary("c", 0.63),
    buildSimulationSummary("d", 0.54)
  ]);
  const open = calculateGroupDifficulty("B", openTeams, [
    buildSimulationSummary("e", 0.96),
    buildSimulationSummary("f", 0.78),
    buildSimulationSummary("g", 0.34),
    buildSimulationSummary("h", 0.12)
  ]);

  assert.ok(hard.score > open.score);
  assert.equal(hard.level, "death");
  assert.ok(hard.pressureIndex > open.pressureIndex);
});

test("模型预设可识别默认配置和自定义配置", () => {
  const formPreset = modelPresets.find((preset) => preset.id === "form-first");

  assert.equal(modelPresets.length, 5);
  assert.equal(getPresetIdForConfig(defaultModelConfig), "balanced");
  assert.ok(formPreset);
  assert.ok(countChangedConfigKeys(formPreset.config) > 0);
  assert.equal(
    getPresetIdForConfig({
      ...defaultModelConfig,
      formWeight: defaultModelConfig.formWeight + 0.01
    }),
    "custom"
  );
});

test("当前比赛敏感项会返回最重要的模型参数", () => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const insights = buildParameterInsights(fixtures[0], teamsById, defaultModelConfig);

  assert.ok(insights.length > 0);
  assert.ok(insights.length <= 3);
  assert.ok(insights[0].value >= insights.at(-1).value);
});

function buildTeam(id, elo) {
  return {
    id,
    name: id.toUpperCase(),
    abbr: id.toUpperCase(),
    group: "A",
    fifaRank: 1,
    elo,
    attack: 1,
    defense: 1,
    form: 0,
    injuries: 0,
    color: "#000",
    source
  };
}

function buildMatch(id, homeTeamId, awayTeamId, homeGoals, awayGoals) {
  return {
    id,
    round: "GROUP",
    group: "A",
    date: "",
    venue: "",
    homeTeamId,
    awayTeamId,
    neutral: true,
    result: { homeGoals, awayGoals },
    source
  };
}

function buildQualified(teamId, group, rank) {
  return {
    teamId,
    group,
    rank,
    standing: {
      teamId,
      group,
      played: 3,
      points: 6,
      wins: 2,
      draws: 0,
      losses: 1,
      goalsFor: 4,
      goalsAgainst: 2,
      goalDifference: 2,
      ratingTieBreak: 1800
    }
  };
}

function buildSimulationSummary(teamId, groupQualification) {
  return {
    teamId,
    group: "A",
    groupQualification,
    round32: groupQualification,
    round16: 0,
    quarterFinal: 0,
    semiFinal: 0,
    final: 0,
    champion: 0,
    championCiLow: 0,
    championCiHigh: 0,
    expectedPoints: 0
  };
}

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}
