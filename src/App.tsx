import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BracketPreview } from "./components/BracketPreview.tsx";
import { ChampionRace } from "./components/ChampionRace.tsx";
import { DataSourcePanel } from "./components/DataSourcePanel.tsx";
import { DataUpdateCenter } from "./components/DataUpdateCenter.tsx";
import { GroupBoard } from "./components/GroupBoard.tsx";
import { Icon } from "./components/Icon.tsx";
import { LatestResultsWall } from "./components/LatestResultsWall.tsx";
import { MatchPredictionCard } from "./components/MatchPredictionCard.tsx";
import { ModelAuditPanel } from "./components/ModelAuditPanel.tsx";
import { ModelControlPanel } from "./components/ModelControlPanel.tsx";
import { ModelEvaluationPanel } from "./components/ModelEvaluationPanel.tsx";
import { SimulationTable } from "./components/SimulationTable.tsx";
import { TeamPowerBoard } from "./components/TeamPowerBoard.tsx";
import {
  clearImportHistory,
  clearRuntimeSnapshot,
  currentTournamentSnapshot,
  loadImportHistory,
  loadRuntimeSnapshot,
  saveImportHistoryEntry,
  saveRuntimeSnapshot
} from "./data/index.ts";
import type { ImportHistoryEntry } from "./data/index.ts";
import { checkLiveSignalUpdate, markLiveSignalApplied } from "./data/liveSignalSync.ts";
import { defaultModelConfig } from "./model/config.ts";
import {
  clearModelConfig,
  loadModelConfig,
  parseModelConfigImport,
  saveModelConfig,
  serializeModelConfig
} from "./model/configStorage.ts";
import { compareModelConfigurations, evaluateCompletedMatches } from "./model/evaluation.ts";
import { predictMatch } from "./model/predict.ts";
import { modelPresetById, type ModelPresetId } from "./model/presets.ts";
import { simulateTournament } from "./model/simulate.ts";
import { calculateGroupStandings } from "./model/standings.ts";
import type {
  DataImportSummary,
  Match,
  ModelConfig,
  PredictionResult,
  SimulationSummary,
  Team,
  TournamentSnapshot
} from "./types.ts";
import { compactNumber, formatDateTime, percent } from "./utils/format.ts";
import {
  buildSimulationWorkerRequest,
  type SimulationWorkerOutboundMessage
} from "./workers/simulationProtocol.ts";

const navItems = [
  { id: "schedule", label: "赛程", icon: "calendar" },
  { id: "simulation", label: "模拟", icon: "gauge" },
  { id: "groups", label: "小组", icon: "shield" },
  { id: "knockout", label: "淘汰赛", icon: "git" },
  { id: "teams", label: "球队", icon: "trophy" },
  { id: "data", label: "数据", icon: "database" }
] as const;

type NavSectionId = (typeof navItems)[number]["id"];

const initialSnapshotState = loadRuntimeSnapshot(currentTournamentSnapshot);
const initialModelConfigState = loadModelConfig(defaultModelConfig);
const initialSeed = 20260613;

type SimulationRunStatus = {
  status: "cancelled" | "completed" | "error" | "running";
  source: "main" | "worker";
  progress: number;
  message: string;
  completedIterations?: number;
  totalIterations?: number;
  elapsedMs?: number;
};

function buildPendingSimulation(teams: Team[], iterations: number, seed: number): SimulationSummary {
  return {
    iterations,
    seed,
    teams: teams.map((team) => ({
      teamId: team.id,
      group: team.group,
      groupQualification: 0,
      round32: 0,
      round16: 0,
      quarterFinal: 0,
      semiFinal: 0,
      final: 0,
      champion: 0,
      championCiLow: 0,
      championCiHigh: 0,
      expectedPoints: 0
    })),
    bracketPreview: teams.slice(0, 16).map((team, index) => ({
      label: index < 8 ? "上半区" : "下半区",
      teamId: team.id,
      probability: 0
    })),
    generatedAt: new Date().toISOString()
  };
}

function formatElapsedTime(elapsedMs?: number): string {
  if (elapsedMs === undefined) {
    return "等待进度";
  }

  if (elapsedMs < 1000) {
    return `${Math.max(1, elapsedMs)} ms`;
  }

  return `${(elapsedMs / 1000).toFixed(1)} s`;
}

function formatFixtureDate(value: string): string {
  return Number.isFinite(Date.parse(value)) ? formatDateTime(value) : "时间待定";
}

function getOutcomeLead(prediction: PredictionResult, home: Team, away: Team) {
  const outcomes = [
    { label: `${home.abbr} 胜`, value: prediction.homeWin },
    { label: "平局", value: prediction.draw },
    { label: `${away.abbr} 胜`, value: prediction.awayWin }
  ];

  return outcomes.reduce((best, outcome) => (outcome.value > best.value ? outcome : best), outcomes[0]);
}

function sortUpcomingFixtures(fixtures: Match[]) {
  return [...fixtures].sort((left, right) => {
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
  });
}

function App() {
  const [snapshot, setSnapshot] = useState<TournamentSnapshot>(initialSnapshotState.snapshot);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>(loadImportHistory());
  const [hasPersistedSnapshot, setHasPersistedSnapshot] = useState(initialSnapshotState.restored);
  const [persistedAt, setPersistedAt] = useState(initialSnapshotState.savedAt);
  const [activeGroup, setActiveGroup] = useState("A");
  const [selectedMatchId, setSelectedMatchId] = useState(
    initialSnapshotState.snapshot.fixtures[0]?.id ?? ""
  );
  const [modelConfig, setModelConfig] = useState<ModelConfig>(initialModelConfigState.config);
  const [hasPersistedModelConfig, setHasPersistedModelConfig] = useState(
    initialModelConfigState.restored
  );
  const [modelConfigSavedAt, setModelConfigSavedAt] = useState(initialModelConfigState.savedAt);
  const [modelConfigMessage, setModelConfigMessage] = useState(
    initialModelConfigState.error ?? ""
  );
  const [activeNavSection, setActiveNavSection] = useState<NavSectionId>("simulation");
  const [seed, setSeed] = useState(initialSeed);
  const [simulation, setSimulation] = useState<SimulationSummary>(
    buildPendingSimulation(
      initialSnapshotState.snapshot.teams,
      initialModelConfigState.config.simulationIterations,
      initialSeed
    )
  );
  const [simulationRun, setSimulationRun] = useState<SimulationRunStatus>({
    status: "running",
    source: "worker",
    progress: 0,
    message: "等待后台模拟"
  });
  const simulationWorkerRef = useRef<Worker | null>(null);
  const simulationTaskIdRef = useRef(0);
  const navInteractionLockRef = useRef(0);
  const [isPending, startTransition] = useTransition();
  const [liveSignalStatus, setLiveSignalStatus] = useState("");

  const config = modelConfig;
  const fixtures = snapshot.fixtures;
  const teams = snapshot.teams;

  const teamsById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams]
  );

  const predictableFixtures = useMemo(
    () =>
      fixtures.filter(
        (match) => teamsById.has(match.homeTeamId) && teamsById.has(match.awayTeamId)
      ),
    [fixtures, teamsById]
  );

  const predictions = useMemo(
    () => predictableFixtures.map((match) => predictMatch(match, teams, config, predictableFixtures)),
    [config, predictableFixtures, teams]
  );
  const predictionsByMatchId = useMemo(
    () => new Map(predictions.map((prediction) => [prediction.matchId, prediction])),
    [predictions]
  );
  const upcomingFixtures = useMemo(
    () =>
      sortUpcomingFixtures(
        predictableFixtures.filter((fixture) => fixture.status !== "completed")
      ).slice(0, 4),
    [predictableFixtures]
  );
  const simulationByTeamId = useMemo(
    () => new Map(simulation.teams.map((summary) => [summary.teamId, summary])),
    [simulation.teams]
  );

  const selectedMatch =
    predictableFixtures.find((match) => match.id === selectedMatchId) ??
    predictableFixtures[0];
  const selectedPrediction = selectedMatch
    ? predictions.find((prediction) => prediction.matchId === selectedMatch.id)
    : undefined;

  const standings = useMemo(
    () => calculateGroupStandings(fixtures, predictions, teams),
    [fixtures, predictions, teams]
  );

  const modelEvaluation = useMemo(
    () => evaluateCompletedMatches(predictableFixtures, teams, config),
    [config, predictableFixtures, teams]
  );
  const modelCalibration = useMemo(
    () => compareModelConfigurations(predictableFixtures, teams, config),
    [config, predictableFixtures, teams]
  );

  useEffect(() => {
    const sections = navItems
      .map((item) => document.getElementById(`section-${item.id}`))
      .filter((section): section is HTMLElement => Boolean(section));

    if (!sections.length || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < navInteractionLockRef.current) {
          return;
        }

        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const sectionId = visibleEntry?.target.getAttribute("data-section-id");

        if (sectionId && navItems.some((item) => item.id === sectionId)) {
          setActiveNavSection(sectionId as NavSectionId);
        }
      },
      {
        rootMargin: "-18% 0px -58% 0px",
        threshold: [0.12, 0.24, 0.5]
      }
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    simulationTaskIdRef.current += 1;
    const requestId = simulationTaskIdRef.current;
    let worker: Worker | undefined;
    let fallbackTimer: number | undefined;

    if (simulationWorkerRef.current) {
      simulationWorkerRef.current.terminate();
      simulationWorkerRef.current = null;
    }

    const runMainThreadFallback = (message: string) => {
      setSimulationRun({
        status: "running",
        source: "main",
        progress: 0,
        message,
        completedIterations: 0,
        totalIterations: config.simulationIterations
      });

      fallbackTimer = window.setTimeout(() => {
        if (simulationTaskIdRef.current !== requestId) {
          return;
        }

        const startedAt = Date.now();
        try {
          const result = simulateTournament(fixtures, teams, config, config.simulationIterations, seed);
          if (simulationTaskIdRef.current !== requestId) {
            return;
          }

          setSimulation(result);
          setSimulationRun({
            status: "completed",
            source: "main",
            progress: 1,
            message: "主线程降级模拟完成",
            completedIterations: config.simulationIterations,
            totalIterations: config.simulationIterations,
            elapsedMs: Date.now() - startedAt
          });
        } catch (error) {
          setSimulationRun({
            status: "error",
            source: "main",
            progress: 0,
            message: error instanceof Error ? error.message : "模拟失败"
          });
        }
      }, 0);
    };

    setSimulationRun({
      status: "running",
      source: "worker",
      progress: 0,
      message: "后台模拟启动中",
      completedIterations: 0,
      totalIterations: config.simulationIterations
    });

    if (typeof Worker === "undefined") {
      runMainThreadFallback("当前浏览器不支持 Web Worker，已降级到主线程模拟。");

      return () => {
        if (fallbackTimer !== undefined) {
          window.clearTimeout(fallbackTimer);
        }
      };
    }

    try {
      worker = new Worker(new URL("./workers/simulation.worker.ts", import.meta.url), {
        type: "module"
      });
      simulationWorkerRef.current = worker;

      worker.onmessage = (event: MessageEvent<SimulationWorkerOutboundMessage>) => {
        const message = event.data;
        if (message.requestId !== requestId || simulationTaskIdRef.current !== requestId) {
          return;
        }

        if (message.type === "progress") {
          setSimulationRun((current) => ({
            ...current,
            status: "running",
            source: "worker",
            progress: message.progress,
            message: "后台模拟中",
            completedIterations: message.completedIterations,
            totalIterations: message.totalIterations,
            elapsedMs: message.elapsedMs
          }));
          return;
        }

        if (message.type === "result") {
          setSimulation(message.simulation);
          setSimulationRun({
            status: "completed",
            source: "worker",
            progress: 1,
            message: "后台模拟完成",
            completedIterations: message.simulation.iterations,
            totalIterations: message.simulation.iterations,
            elapsedMs: message.elapsedMs
          });
          worker?.terminate();
          if (simulationWorkerRef.current === worker) {
            simulationWorkerRef.current = null;
          }
          return;
        }

        worker?.terminate();
        if (simulationWorkerRef.current === worker) {
          simulationWorkerRef.current = null;
        }
        runMainThreadFallback(`后台模拟失败，已降级：${message.message}`);
      };

      worker.onerror = () => {
        if (simulationTaskIdRef.current !== requestId) {
          return;
        }

        worker?.terminate();
        if (simulationWorkerRef.current === worker) {
          simulationWorkerRef.current = null;
        }
        runMainThreadFallback("后台模拟不可用，已自动降级。");
      };

      worker.postMessage(
        buildSimulationWorkerRequest({
          requestId,
          fixtures,
          teams,
          config,
          iterations: config.simulationIterations,
          seed
        })
      );
    } catch {
      runMainThreadFallback("后台模拟启动失败，已自动降级。");
    }

    return () => {
      if (fallbackTimer !== undefined) {
        window.clearTimeout(fallbackTimer);
      }
      worker?.terminate();
      if (simulationWorkerRef.current === worker) {
        simulationWorkerRef.current = null;
      }
    };
  }, [config, fixtures, seed, teams]);

  useEffect(() => {
    let cancelled = false;

    async function syncLiveSignal() {
      const result = await checkLiveSignalUpdate(snapshot);
      if (cancelled || !result) {
        return;
      }

      applySnapshotImport(result.snapshot, result.summary);
      markLiveSignalApplied(result.appliedKey);
      const resultsNote =
        result.summary.importedResults > 0
          ? `新增 ${result.summary.importedResults} 场赛果，`
          : "";
      setLiveSignalStatus(
        `${resultsNote}已自动融合实时赔率与赛事内战绩，更新 ${result.summary.importedTeams} 支球队状态（${formatDateTime(new Date().toISOString())}）。`
      );
    }

    syncLiveSignal();
    const intervalId = window.setInterval(syncLiveSignal, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [snapshot]);

  const topChampion = simulation.teams[0];
  const topChampionTeam = topChampion ? teamsById.get(topChampion.teamId) : undefined;
  const nextFixtures = predictableFixtures
    .filter((fixture) => fixture.group === activeGroup)
    .slice(0, 6);
  const simulationProgressPercent = Math.round(simulationRun.progress * 100);
  const canCancelSimulation =
    simulationRun.status === "running" && simulationRun.source === "worker";

  function updateConfig(nextConfig: ModelConfig) {
    startTransition(() => setModelConfig(nextConfig));
  }

  function applyPreset(presetId: ModelPresetId) {
    const preset = modelPresetById.get(presetId);
    if (!preset) {
      return;
    }

    startTransition(() => setModelConfig({ ...preset.config }));
  }

  function resetConfig() {
    startTransition(() => setModelConfig(defaultModelConfig));
  }

  function persistConfig() {
    try {
      const savedAt = saveModelConfig(config);
      setHasPersistedModelConfig(Boolean(savedAt));
      setModelConfigSavedAt(savedAt);
      setModelConfigMessage(savedAt ? "模型参数已保存到本地。" : "当前环境不支持本地保存。");
    } catch (error) {
      setModelConfigMessage(error instanceof Error ? error.message : "模型参数保存失败。");
    }
  }

  function clearPersistedConfig() {
    clearModelConfig();
    setHasPersistedModelConfig(false);
    setModelConfigSavedAt(undefined);
    setModelConfigMessage("已清除本地保存的模型参数。");
  }

  function exportConfig() {
    const blob = new Blob([serializeModelConfig(config)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "world-cup-2026-model-config.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setModelConfigMessage("模型参数 JSON 已导出。");
  }

  function importConfigText(text: string) {
    try {
      const nextConfig = parseModelConfigImport(text);
      startTransition(() => setModelConfig(nextConfig));
      setModelConfigMessage("模型参数已导入，保存后会写入本地。");
    } catch (error) {
      setModelConfigMessage(error instanceof Error ? error.message : "模型参数导入失败。");
    }
  }

  function rerunSimulation() {
    startTransition(() => setSeed((value) => value + 97));
  }

  function cancelSimulation() {
    simulationTaskIdRef.current += 1;
    simulationWorkerRef.current?.terminate();
    simulationWorkerRef.current = null;
    setSimulationRun((current) => ({
      ...current,
      status: "cancelled",
      progress: 0,
      message: "模拟已取消，保留上一次结果。"
    }));
  }

  function applySnapshotImport(nextSnapshot: TournamentSnapshot, summary: DataImportSummary) {
    startTransition(() => {
      const nextHistory = saveImportHistoryEntry({ summary, snapshot });
      const savedAt = saveRuntimeSnapshot(nextSnapshot);

      setSnapshot(nextSnapshot);
      setImportHistory(nextHistory);
      setHasPersistedSnapshot(Boolean(savedAt));
      setPersistedAt(savedAt);
      setSeed((value) => value + 131);
      if (!nextSnapshot.fixtures.some((fixture) => fixture.id === selectedMatchId)) {
        setSelectedMatchId(nextSnapshot.fixtures[0]?.id ?? selectedMatchId);
      }
    });
  }

  function restoreImportHistory(entryId: string) {
    const entry = importHistory.find((item) => item.id === entryId);
    if (!entry) {
      return;
    }

    startTransition(() => {
      const savedAt = saveRuntimeSnapshot(entry.snapshot);

      setSnapshot(entry.snapshot);
      setHasPersistedSnapshot(Boolean(savedAt));
      setPersistedAt(savedAt);
      setSeed((value) => value + 137);
      if (!entry.snapshot.fixtures.some((fixture) => fixture.id === selectedMatchId)) {
        setSelectedMatchId(entry.snapshot.fixtures[0]?.id ?? selectedMatchId);
      }
    });
  }

  function clearSnapshotImportHistory() {
    clearImportHistory();
    setImportHistory([]);
  }

  function resetSnapshot() {
    startTransition(() => {
      clearRuntimeSnapshot();
      setSnapshot(currentTournamentSnapshot);
      setHasPersistedSnapshot(false);
      setPersistedAt(undefined);
      setSeed((value) => value + 149);
      setSelectedMatchId(currentTournamentSnapshot.fixtures[0]?.id ?? "");
    });
  }

  function scrollToSection(sectionId: NavSectionId) {
    navInteractionLockRef.current = Date.now() + 1400;
    setActiveNavSection(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>26</span>
          <strong>世界杯预测</strong>
        </div>
        <nav aria-label="主导航">
          {navItems.map((item) => {
            return (
              <button
                aria-current={activeNavSection === item.id ? "page" : undefined}
                className={activeNavSection === item.id ? "is-active" : ""}
                key={item.label}
                onClick={() => scrollToSection(item.id)}
                type="button"
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-card">
          <span>冠军概率领先</span>
          <strong>{topChampionTeam?.name ?? "暂无球队"}</strong>
          <em>{topChampion ? (topChampion.champion * 100).toFixed(1) : "0.0"}%</em>
          <ChampionRace simulation={simulation} teamsById={teamsById} />
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <h1>2026 世界杯胜平负与晋级模拟</h1>
            <p>
              官方/核验数据快照 · 泊松比分模型 · {compactNumber(config.simulationIterations)} 次蒙特卡洛
            </p>
          </div>
          <div className="topbar__right">
            <div className="topbar__controls">
              <label>
                模拟次数
                <select
                  value={config.simulationIterations}
                  onChange={(event: { target: { value: string } }) =>
                    updateConfig({
                      ...config,
                      simulationIterations: Number(event.target.value)
                    })
                  }
                >
                  <option value={1000}>1,000</option>
                  <option value={5000}>5,000</option>
                  <option value={10000}>10,000</option>
                  <option value={25000}>25,000</option>
                </select>
              </label>
              <button
                className="primary-action"
                onClick={rerunSimulation}
                type="button"
              >
                <Icon name={simulationRun.status === "running" || isPending ? "refresh" : "play"} size={17} />
                {simulationRun.status === "running" ? "重新开始" : "重新模拟"}
              </button>
              {canCancelSimulation ? (
                <button className="secondary-action" onClick={cancelSimulation} type="button">
                  <Icon name="x" size={15} />
                  取消
                </button>
              ) : null}
            </div>
            <div className={`simulation-runner simulation-runner--${simulationRun.status}`}>
              <div>
                <span>后台模拟</span>
                <strong>{simulationRun.message}</strong>
                <em>
                  {simulationRun.completedIterations?.toLocaleString("zh-CN") ?? 0}/
                  {(simulationRun.totalIterations ?? config.simulationIterations).toLocaleString("zh-CN")} ·{" "}
                  {formatElapsedTime(simulationRun.elapsedMs)}
                </em>
              </div>
              <div className="simulation-runner__track" aria-label={`模拟进度 ${simulationProgressPercent}%`}>
                <b style={{ width: `${simulationProgressPercent}%` }} />
              </div>
            </div>
          </div>
        </header>

        <div className="dashboard-overview">
          <section className="status-strip" aria-label="数据状态">
            <div>
              <span>数据更新时间</span>
              <strong>{formatDateTime(snapshot.collectedAt)}</strong>
            </div>
            <div>
              <span>数据置信度</span>
              <strong>官方 + 核验快照</strong>
            </div>
            <div>
              <span>模型参数</span>
              <strong>泊松 + DC 修正</strong>
            </div>
            <div>
              <span>接入路线</span>
              <strong>{snapshot.completedMatches} 场赛果已入模</strong>
            </div>
            {liveSignalStatus ? (
              <div>
                <span>实时数据同步</span>
                <strong>{liveSignalStatus}</strong>
              </div>
            ) : null}
          </section>

          <section className="panel daily-match-panel" aria-label="今日重点比赛">
            <div className="panel__header compact">
              <div>
                <span className="eyebrow">今日重点</span>
                <h2>接下来最值得跟踪的比赛</h2>
              </div>
              <span className="table-meta">按开赛时间排序 · 点击切换单场预测</span>
            </div>
            <div className="daily-match-list">
              {upcomingFixtures.map((fixture) => {
                const home = teamsById.get(fixture.homeTeamId);
                const away = teamsById.get(fixture.awayTeamId);
                const prediction = predictionsByMatchId.get(fixture.id);

                if (!home || !away || !prediction) {
                  return null;
                }

                const topScore = prediction.topScores[0];
                const outcomeLead = getOutcomeLead(prediction, home, away);

                return (
                  <button
                    aria-label={`查看 ${home.name} 对 ${away.name} 的重点预测`}
                    aria-pressed={fixture.id === selectedMatch?.id}
                    className={fixture.id === selectedMatch?.id ? "daily-match-card is-active" : "daily-match-card"}
                    key={fixture.id}
                    onClick={() => setSelectedMatchId(fixture.id)}
                    type="button"
                  >
                    <span className="daily-match-card__meta">
                      <span>MD {fixture.matchday ?? "-"} · {formatFixtureDate(fixture.date)}</span>
                      <em>{outcomeLead.label}</em>
                    </span>
                    <span className="daily-match-card__teams">
                      <span>
                        <i style={{ backgroundColor: home.color }} />
                        {home.abbr}
                      </span>
                      <strong>vs</strong>
                      <span>
                        <i style={{ backgroundColor: away.color }} />
                        {away.abbr}
                      </span>
                    </span>
                    <span className="daily-match-card__probability">
                      <b style={{ width: percent(outcomeLead.value, 2) }} />
                    </span>
                    <span className="daily-match-card__details">
                      <span>主 {percent(prediction.homeWin, 0)}</span>
                      <span>平 {percent(prediction.draw, 0)}</span>
                      <span>客 {percent(prediction.awayWin, 0)}</span>
                    </span>
                    <span className="daily-match-card__footer">
                      <span>
                        最热比分{" "}
                        {topScore
                          ? `${topScore.homeGoals}-${topScore.awayGoals} ${percent(topScore.probability, 1)}`
                          : "待定"}
                      </span>
                      <span>置信 {percent(prediction.confidence, 0)}</span>
                    </span>
                  </button>
                );
              })}
              {upcomingFixtures.length === 0 ? (
                <p className="panel-empty">当前快照没有未完赛程。</p>
              ) : null}
            </div>
          </section>
        </div>

        <LatestResultsWall fixtures={fixtures} teamsById={teamsById} />

        <div className="prediction-layout">
          <div className="left-column">
            <div className="section-anchor" data-section-id="groups" id="section-groups">
              <GroupBoard
                activeGroup={activeGroup}
                onGroupChange={setActiveGroup}
                simulationByTeamId={simulationByTeamId}
                standings={standings}
                teamsById={teamsById}
              />
            </div>
            <section
              className="panel fixture-panel section-anchor"
              data-section-id="schedule"
              id="section-schedule"
            >
              <div className="panel__header compact">
                <div>
                  <span className="eyebrow">赛程</span>
                  <h2>{activeGroup} 组比赛</h2>
                </div>
              </div>
              <div className="fixture-list">
                {nextFixtures.map((fixture) => {
                  const home = teamsById.get(fixture.homeTeamId);
                  const away = teamsById.get(fixture.awayTeamId);
                  const fixturePrediction = predictionsByMatchId.get(fixture.id);
                  const score = fixture.result
                    ? `${fixture.result.homeGoals}-${fixture.result.awayGoals}`
                    : "vs";
                  if (!home || !away) {
                    return null;
                  }

                  return (
                    <button
                      aria-label={`选择比赛 ${home.name} 对 ${away.name}，${fixture.status === "completed" ? "已完赛" : "预测"}`}
                      aria-pressed={fixture.id === selectedMatch?.id}
                      className={fixture.id === selectedMatch?.id ? "is-active" : ""}
                      key={fixture.id}
                      onClick={() => setSelectedMatchId(fixture.id)}
                      type="button"
                    >
                      <span className="fixture-card__meta">
                        <span>
                          MD {fixture.matchday ?? "-"} · {formatFixtureDate(fixture.date)}
                        </span>
                        <em>{fixture.status === "completed" ? "已完赛" : "预测"}</em>
                      </span>
                      <span className="fixture-card__teams">
                        <span>
                          <i style={{ backgroundColor: home.color }} />
                          {home.abbr}
                        </span>
                        <strong>{score}</strong>
                        <span>
                          <i style={{ backgroundColor: away.color }} />
                          {away.abbr}
                        </span>
                      </span>
                      <span className="fixture-card__venue">{fixture.venue}</span>
                      {fixturePrediction ? (
                        <span className="fixture-card__probabilities">
                          <span>主 {percent(fixturePrediction.homeWin, 0)}</span>
                          <span>平 {percent(fixturePrediction.draw, 0)}</span>
                          <span>客 {percent(fixturePrediction.awayWin, 0)}</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {nextFixtures.length === 0 ? (
                  <p className="panel-empty">当前小组没有可预测比赛。</p>
                ) : null}
              </div>
            </section>
          </div>

          <div className="main-column section-anchor" data-section-id="simulation" id="section-simulation">
            {selectedMatch && selectedPrediction ? (
              <MatchPredictionCard
                match={selectedMatch}
                prediction={selectedPrediction}
                teamsById={teamsById}
              />
            ) : (
              <section className="panel match-panel">
                <div className="panel__header">
                  <div>
                    <span className="eyebrow">选中比赛</span>
                    <h2>暂无可预测比赛</h2>
                  </div>
                </div>
                <p className="panel-empty">
                  当前快照缺少赛程或球队映射。请导入完整数据包，或恢复内置快照。
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="section-anchor knockout-band" data-section-id="knockout" id="section-knockout">
          <BracketPreview simulation={simulation} teamsById={teamsById} />
        </div>

        <div className="operations-grid" aria-label="模型与数据工作区">
          <div className="operations-primary">
            {selectedMatch ? (
              <ModelControlPanel
                config={config}
                hasPersistedConfig={hasPersistedModelConfig}
                message={modelConfigMessage}
                onConfigChange={updateConfig}
                onConfigClear={clearPersistedConfig}
                onConfigExport={exportConfig}
                onConfigImport={importConfigText}
                onConfigSave={persistConfig}
                onPresetChange={applyPreset}
                onReset={resetConfig}
                savedAt={modelConfigSavedAt}
                selectedMatch={selectedMatch}
                teamsById={teamsById}
              />
            ) : null}
          </div>
          <div className="operations-secondary">
            <ModelAuditPanel
              modelConfig={config}
              simulation={simulation}
              snapshot={snapshot}
            />
            <ModelEvaluationPanel
              calibration={modelCalibration}
              evaluation={modelEvaluation}
              fixtures={fixtures}
              onPresetApply={applyPreset}
              teamsById={teamsById}
            />
            <DataSourcePanel snapshot={snapshot} />
          </div>
        </div>

        <div className="section-anchor" data-section-id="data" id="section-data">
          <DataUpdateCenter
            canResetSnapshot={snapshot !== currentTournamentSnapshot || hasPersistedSnapshot}
            hasPersistedSnapshot={hasPersistedSnapshot}
            importHistory={importHistory}
            modelConfig={config}
            onHistoryClear={clearSnapshotImportHistory}
            onHistoryRestore={restoreImportHistory}
            onSnapshotImport={applySnapshotImport}
            onSnapshotReset={resetSnapshot}
            persistedAt={persistedAt}
            selectedMatchId={selectedMatch?.id ?? selectedMatchId}
            snapshot={snapshot}
          />
        </div>

        <div className="section-anchor" data-section-id="teams" id="section-teams">
          <TeamPowerBoard simulation={simulation} teams={teams} />
          <SimulationTable
            modelConfig={config}
            simulation={simulation}
            snapshot={snapshot}
            teamsById={teamsById}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
