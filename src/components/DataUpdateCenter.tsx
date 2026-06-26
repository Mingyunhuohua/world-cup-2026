import { useMemo, useState } from "react";
import {
  buildImportModelImpact,
  buildBulkResultsTemplate,
  buildCombinedDataPackageTemplate,
  buildFixtureImportHelpers,
  buildFixturePatchTemplate,
  buildLocalDataUpdateReport,
  buildResultImportTemplate,
  buildSnapshotFilename,
  clearImportRecapHistory,
  getImportHelperGroups,
  loadImportRecapHistory,
  previewTournamentImport,
  saveImportRecapHistoryEntry,
  serializeTournamentSnapshot
} from "../data/index.ts";
import { countQualityLevels } from "../data/quality.ts";
import type { ImportHistoryEntry, ImportRecapEntry } from "../data/index.ts";
import type { ImportModelImpact } from "../data/importImpact.ts";
import type { ImportPreview } from "../data/importPreview.ts";
import type {
  DataImportSummary,
  DataFeedResult,
  DataFeedStatus,
  DataQualityCheck,
  DataUpdateReport,
  Match,
  ModelConfig,
  TournamentSnapshot
} from "../types.ts";
import { formatDateTime, percent } from "../utils/format.ts";
import { Icon } from "./Icon.tsx";
import { TournamentProgress } from "./TournamentProgress.tsx";

type DataUpdateCenterProps = {
  snapshot: TournamentSnapshot;
  modelConfig: ModelConfig;
  selectedMatchId: string;
  canResetSnapshot: boolean;
  hasPersistedSnapshot: boolean;
  importHistory: ImportHistoryEntry[];
  persistedAt?: string;
  onHistoryClear: () => void;
  onHistoryRestore: (entryId: string) => void;
  onSnapshotImport: (snapshot: TournamentSnapshot, summary: DataImportSummary) => void;
  onSnapshotReset: () => void;
};

type RefreshState = "idle" | "running" | "done";
type ImportState = {
  kind: "idle" | "success" | "error";
  message: string;
  warnings: string[];
};

const statusLabels: Record<DataFeedStatus, string> = {
  blocked: "受限",
  placeholder: "占位",
  planned: "待接入",
  ready: "就绪"
};

const statusIcons: Record<DataFeedStatus, "activity" | "alert" | "database" | "shield"> = {
  blocked: "alert",
  placeholder: "activity",
  planned: "database",
  ready: "shield"
};

const composeCommand = [
  "npm.cmd run data:compose -- `",
  "  --source fifa-fixtures=imports/examples/fifa-fixtures.json `",
  "  --source fifa-rankings=imports/examples/fifa-rankings.csv `",
  "  --source injuries-news=imports/examples/injuries-news.csv `",
  "  --source odds-market=imports/examples/odds-market.csv `",
  "  --source recent-form=imports/examples/recent-form.csv `",
  "  --source news-sentiment=imports/examples/news-sentiment.csv `",
  "  --label \"Daily verified import\" `",
  "  --out imports/generated/worldcup-2026-daily-import.json"
].join("\n");

const templateSourceItems = [
  {
    id: "fifa-fixtures",
    file: "imports/examples/fifa-fixtures.json",
    label: "赛程/赛果",
    detail: "比赛 ID、日期、场地、状态和比分。"
  },
  {
    id: "fifa-rankings",
    file: "imports/examples/fifa-rankings.csv",
    label: "排名评分",
    detail: "FIFA 排名、ELO、基础攻防和状态。"
  },
  {
    id: "injuries-news",
    file: "imports/examples/injuries-news.csv",
    label: "伤停新闻",
    detail: "球队级伤停负荷、阵容完整度和临场风险。"
  },
  {
    id: "odds-market",
    file: "imports/examples/odds-market.csv",
    label: "赔率市场",
    detail: "冠军赔率、隐含概率和市场信号。"
  },
  {
    id: "recent-form",
    file: "imports/examples/recent-form.csv",
    label: "近期战绩",
    detail: "近况序列、胜平负和进失球趋势。"
  },
  {
    id: "news-sentiment",
    file: "imports/examples/news-sentiment.csv",
    label: "新闻舆情",
    detail: "情绪、热度、风险和伤停提及。"
  }
];

const importGuardrails = [
  "赛程 id 必须匹配当前快照；不匹配的比赛不会进入预检变化。",
  "模板数值是格式示例，正式导入前先替换为当天核验数据。",
  "预检出现质量警告时，先检查对阵、已完赛比分和球队数量。"
];

type DailyWorkflowItem = {
  label: string;
  detail: string;
  tone: "ok" | "warn" | "danger";
};

type UpdateRunbookStep = {
  label: string;
  detail: string;
  status: "done" | "current" | "pending";
};

type UpdateWorkspaceItem = {
  label: string;
  value: string;
  detail: string;
  icon: "database" | "git" | "search" | "shield";
  tone: "green" | "blue" | "orange";
};

type PreviewAuditSummary = {
  level: "pass" | "warn" | "risk";
  title: string;
  detail: string;
  tiles: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
};

export function DataUpdateCenter({
  canResetSnapshot,
  hasPersistedSnapshot,
  importHistory,
  modelConfig,
  onHistoryClear,
  onHistoryRestore,
  onSnapshotImport,
  onSnapshotReset,
  persistedAt,
  selectedMatchId,
  snapshot
}: DataUpdateCenterProps) {
  const [refreshTimestamp, setRefreshTimestamp] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [importDraft, setImportDraft] = useState("");
  const [helperGroup, setHelperGroup] = useState("ALL");
  const [importState, setImportState] = useState<ImportState>({
    kind: "idle",
    message: "",
    warnings: []
  });
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importImpact, setImportImpact] = useState<ImportModelImpact | null>(null);
  const [appliedRecap, setAppliedRecap] = useState<ImportRecapEntry | null>(null);
  const [importRecapHistory, setImportRecapHistory] = useState<ImportRecapEntry[]>(
    loadImportRecapHistory()
  );
  const report = useMemo<DataUpdateReport>(() => {
    const nextReport = buildLocalDataUpdateReport(snapshot);

    return {
      ...nextReport,
      generatedAt: refreshTimestamp ?? snapshot.collectedAt
    };
  }, [refreshTimestamp, snapshot]);
  const qualityCounts = countQualityLevels(report.qualityChecks);
  const readyFeeds = report.feeds.filter((feed) => feed.status === "ready").length;
  const dynamicFeeds = report.feeds.filter(
    (feed) => feed.status === "placeholder" || feed.status === "planned"
  ).length;
  const helperGroups = useMemo(() => getImportHelperGroups(snapshot), [snapshot]);
  const fixtureHelpers = useMemo(
    () => buildFixtureImportHelpers(snapshot, helperGroup).slice(0, 12),
    [helperGroup, snapshot]
  );
  const dailyWorkflow = useMemo(
    () => buildDailyWorkflow(report, snapshot, importImpact),
    [importImpact, report, snapshot]
  );
  const updateRunbook = useMemo(
    () => buildUpdateRunbook(importDraft, importImpact, importPreview, importState),
    [importDraft, importImpact, importPreview, importState]
  );
  const workspaceItems = useMemo(
    () =>
      buildUpdateWorkspaceItems({
        dynamicFeeds,
        importDraft,
        importHistoryCount: importHistory.length,
        importPreview,
        importRecapHistoryCount: importRecapHistory.length,
        importState
      }),
    [dynamicFeeds, importDraft, importHistory.length, importPreview, importRecapHistory.length, importState]
  );

  async function refreshLocalSnapshot() {
    setRefreshState("running");
    setRefreshTimestamp(new Date().toISOString());
    setRefreshState("done");
  }

  function resetImportFeedback() {
    setImportPreview(null);
    setImportImpact(null);
    setImportState({ kind: "idle", message: "", warnings: [] });
  }

  function updateImportDraft(value: string) {
    setImportDraft(value);
    resetImportFeedback();
  }

  function previewImportText(text: string) {
    try {
      const preview = previewTournamentImport(text, snapshot);
      const impact = buildImportModelImpact(snapshot, preview.snapshot, modelConfig, {
        selectedMatchId
      });

      setImportPreview(preview);
      setImportImpact(impact);
      setImportState({
        kind: "idle",
        message: "",
        warnings: preview.summary.warnings
      });
    } catch (error) {
      setImportPreview(null);
      setImportImpact(null);
      setImportState({
        kind: "error",
        message: error instanceof Error ? error.message : "预检失败。",
        warnings: []
      });
    }
  }

  function confirmImportPreview() {
    if (!importPreview) {
      previewImportText(importDraft);
      return;
    }

    const appliedAt = new Date().toISOString();
    const summary = {
      ...importPreview.summary,
      appliedAt
    };
    const nextRecapHistory = saveImportRecapHistoryEntry({
      appliedAt,
      fixtureChanges: importPreview.fixtureChanges,
      matchImpacts: importImpact?.matchImpacts ?? [],
      sourceSnapshot: {
        collectedAt: importPreview.snapshot.collectedAt,
        id: importPreview.snapshot.id,
        label: importPreview.snapshot.label
      },
      sources: importPreview.snapshot.sources,
      summary,
      teamChanges: importPreview.teamChanges,
      teamImpacts: importImpact?.teamImpacts ?? [],
      warnings: summary.warnings
    });

    onSnapshotImport(importPreview.snapshot, summary);
    setImportRecapHistory(nextRecapHistory);
    setAppliedRecap(nextRecapHistory[0] ?? null);
    setImportState({
      kind: "success",
      message: `${summary.importedFixtures} 场赛程，${summary.importedResults} 条赛果，${summary.importedDiscipline ?? 0} 条纪律数据，${summary.importedTeams} 支球队已导入。`,
      warnings: summary.warnings
    });
    setImportPreview(null);
  }

  async function importFile(event: { target: { files?: FileList | null; value?: string } }) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();

    setImportDraft(text);
    previewImportText(text);
    event.target.value = "";
  }

  function exportSnapshot() {
    const blob = new Blob([serializeTournamentSnapshot(snapshot)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = buildSnapshotFilename(snapshot);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function fillBulkTemplate() {
    setImportDraft(buildBulkResultsTemplate(snapshot));
    resetImportFeedback();
  }

  function fillCombinedTemplate() {
    setImportDraft(buildCombinedDataPackageTemplate(snapshot));
    resetImportFeedback();
  }

  function clearRecapHistory() {
    if (importRecapHistory.length === 0) {
      return;
    }

    if (!window.confirm("确认清空导入复盘历史？当前预测快照不会受影响。")) {
      return;
    }

    clearImportRecapHistory();
    setImportRecapHistory([]);
    setAppliedRecap(null);
  }

  function clearRollbackHistory() {
    if (importHistory.length === 0) {
      return;
    }

    if (!window.confirm("确认清空导入回滚历史？当前预测快照不会受影响，但不能再用这些记录恢复旧状态。")) {
      return;
    }

    onHistoryClear();
  }

  return (
    <section className="panel update-center">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">数据更新中心</span>
          <h2>数据源状态与质量检查</h2>
        </div>
        <button
          className="secondary-action"
          disabled={refreshState === "running"}
          onClick={refreshLocalSnapshot}
          type="button"
        >
          <Icon name="refresh" size={15} />
          {refreshState === "running" ? "刷新中" : "刷新快照"}
        </button>
      </div>

      <div className="update-summary">
        <SummaryTile label="当前适配器" value={report.adapterLabel} />
        <SummaryTile label="就绪数据流" value={`${readyFeeds}/${report.feeds.length}`} />
        <SummaryTile label="待实接动态流" value={dynamicFeeds} />
        <SummaryTile label="质量警告" value={qualityCounts.warn + qualityCounts.fail} />
        <SummaryTile label="刷新时间" value={formatDateTime(report.generatedAt)} />
        <SummaryTile
          label="本地保存"
          value={hasPersistedSnapshot ? formatDateTime(persistedAt ?? snapshot.collectedAt) : "未保存"}
        />
      </div>

      <DailyWorkflowPanel workflow={dailyWorkflow} />
      <UpdateRunbookPanel steps={updateRunbook} />
      <UpdateWorkspaceMap items={workspaceItems} />
      {appliedRecap ? (
        <AppliedImportRecapPanel
          recap={appliedRecap}
          onDismiss={() => setAppliedRecap(null)}
        />
      ) : null}

      <div className="update-workflow">
        <div className="update-workflow__primary">
          <div className="update-workflow__column-header">
            <div>
              <span className="eyebrow">主操作区</span>
              <strong>导入、预检和比赛定位</strong>
            </div>
            <em>{importPreview ? "等待确认应用" : importDraft.trim() ? "可预检" : "待输入数据"}</em>
          </div>
          <section className="update-step">
            <StepHeader
              description="粘贴或上传 JSON，先预检变化和模型影响，再确认应用到当前快照。"
              index="1"
              title="导入与预检"
            />
            <div className="import-panel">
              <div className="import-panel__main">
                <label>
                  JSON 导入
                  <textarea
                    onChange={(event: { target: { value: string } }) =>
                      updateImportDraft(event.target.value)
                    }
                    placeholder='{"results":[{"matchId":"m01","homeGoals":2,"awayGoals":0}]}'
                    value={importDraft}
                  />
                </label>
                <div className="template-actions" aria-label="导入模板">
                  <button className="secondary-action" onClick={fillBulkTemplate} type="button">
                    <Icon name="database" size={15} />
                    批量赛果模板
                  </button>
                  <button className="secondary-action" onClick={fillCombinedTemplate} type="button">
                    <Icon name="trending" size={15} />
                    组合包示例
                  </button>
                  {snapshot.fixtures[0] ? (
                    <button
                      className="secondary-action"
                      onClick={() => {
                        setImportDraft(buildResultImportTemplate(snapshot.fixtures[0]));
                        resetImportFeedback();
                      }}
                      type="button"
                    >
                      <Icon name="play" size={15} />
                      单场赛果模板
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="import-panel__actions">
                <label className="file-import">
                  <Icon name="database" size={15} />
                  上传 JSON
                  <input accept=".json,application/json" onChange={importFile} type="file" />
                </label>
                <button
                  className="primary-action"
                  disabled={importDraft.trim().length === 0}
                  onClick={importPreview ? confirmImportPreview : () => previewImportText(importDraft)}
                  type="button"
                >
                  <Icon name={importPreview ? "play" : "search"} size={15} />
                  {importPreview ? "确认应用" : "预检导入"}
                </button>
                <button className="secondary-action" onClick={exportSnapshot} type="button">
                  <Icon name="database" size={15} />
                  导出快照
                </button>
                <button
                  className="secondary-action"
                  disabled={!canResetSnapshot}
                  onClick={onSnapshotReset}
                  type="button"
                >
                  <Icon name="refresh" size={15} />
                  恢复内置
                </button>
                {importState.kind !== "idle" ? (
                  <div className={`import-status import-status--${importState.kind}`}>
                    <strong>{importState.kind === "success" ? "导入完成" : "导入失败"}</strong>
                    <p>{importState.message}</p>
                    {importState.warnings.length > 0 ? (
                      <span>{importState.warnings.slice(0, 2).join("；")}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {importPreview ? <ImportPreviewPanel impact={importImpact} preview={importPreview} /> : null}
          </section>

          <section className="update-step">
            <div className="fixture-helper">
              <div className="fixture-helper__header">
                <StepHeader
                  description="点击模板会把对应比赛填入 JSON 导入框。"
                  index="2"
                  title="比赛 ID 辅助"
                />
                <label>
                  小组
                  <select
                    onChange={(event: { target: { value: string } }) => setHelperGroup(event.target.value)}
                    value={helperGroup}
                  >
                    <option value="ALL">全部</option>
                    {helperGroups.map((group) => (
                      <option key={group} value={group}>
                        {group} 组
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="fixture-helper__list">
                {fixtureHelpers.map((fixture) => {
                  const match = snapshot.fixtures.find((item) => item.id === fixture.id);
                  if (!match) {
                    return null;
                  }

                  return (
                    <article className="fixture-helper__item" key={fixture.id}>
                      <div>
                        <strong>{fixture.id}</strong>
                        <p>
                          {fixture.homeAbbr} vs {fixture.awayAbbr} · {fixture.group} 组第{" "}
                          {fixture.matchday} 轮
                        </p>
                        <span>
                          {fixture.status === "completed" ? "已完赛" : "未完赛"} · {fixture.score}
                        </span>
                      </div>
                      <div className="fixture-helper__actions">
                        <button
                          className="secondary-action"
                          onClick={() => setImportDraft(buildResultImportTemplate(match))}
                          type="button"
                        >
                          赛果
                        </button>
                        <button
                          className="secondary-action"
                          onClick={() => setImportDraft(buildFixturePatchTemplate(match))}
                          type="button"
                        >
                          赛程
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <TournamentProgress snapshot={snapshot} />
        </div>

        <aside className="update-workflow__side">
          <div className="update-workflow__column-header">
            <div>
              <span className="eyebrow">审计与准备区</span>
              <strong>复盘、回滚和每日模板</strong>
            </div>
            <em>{importRecapHistory.length + importHistory.length} 条本地记录</em>
          </div>
          <ImportRecapHistoryPanel
            history={importRecapHistory}
            onClear={clearRecapHistory}
            onInspect={setAppliedRecap}
          />
          <ImportHistoryPanel
            history={importHistory}
            onClear={clearRollbackHistory}
            onRestore={onHistoryRestore}
          />

          <section className="update-step update-step--compact">
            <StepHeader
              description="把排名、伤停、赔率、近期战绩和舆情合并成一个可导入包。"
              index="3"
              title="组合数据包"
            />
            <div className="template-library">
              <div className="compose-guide__title">
                <span className="feed-card__icon">
                  <Icon name="database" size={15} />
                </span>
                <div>
                  <strong>每日数据模板</strong>
                  <p>先更新这些本地文件，再生成网页可预检的 JSON。</p>
                </div>
              </div>
              <div className="template-file-grid">
                {templateSourceItems.map((item) => (
                  <article className="template-file-card" key={item.id}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.id}</span>
                    </div>
                    <code>{item.file}</code>
                    <p>{item.detail}</p>
                  </article>
                ))}
              </div>
              <div className="update-guardrails">
                {importGuardrails.map((item) => (
                  <p key={item}>
                    <Icon name="alert" size={14} />
                    <span>{item}</span>
                  </p>
                ))}
              </div>
            </div>
            <div className="compose-guide">
              <article className="compose-guide__card">
                <div className="compose-guide__title">
                  <span className="feed-card__icon">
                    <Icon name="git" size={15} />
                  </span>
                  <div>
                    <strong>处理流程</strong>
                    <p>多源 adapter 输出会合并成一个运行态导入包。</p>
                  </div>
                </div>
                <ol>
                  <li>更新左侧模板文件，保留来源和核验时间。</li>
                  <li>运行组合命令生成 `worldcup-2026-daily-import.json`。</li>
                  <li>上传或粘贴 JSON，确认预检和模型影响后再应用。</li>
                </ol>
              </article>
              <article className="compose-guide__card">
                <div className="compose-guide__title">
                  <span className="feed-card__icon">
                    <Icon name="database" size={15} />
                  </span>
                  <div>
                    <strong>常用组合命令</strong>
                    <p>动态字段取多源平均，静态字段以后一个来源为准。</p>
                  </div>
                </div>
                <pre>{composeCommand}</pre>
              </article>
            </div>
          </section>
        </aside>
      </div>

      <section className="update-step update-step--health">
        <StepHeader
          description="用于判断当前快照是否足够完整，以及哪些动态数据源还只是占位。"
          index="4"
          title="数据流与质量检查"
        />
        <div className="update-grid">
          <div className="update-column">
            <div className="subheading">数据流</div>
            <div className="feed-list">
              {report.feeds.map((feed) => (
                <FeedCard feed={feed} key={feed.id} />
              ))}
            </div>
          </div>

          <div className="update-column">
            <div className="subheading">质量检查</div>
            <div className="quality-list">
              {report.qualityChecks.map((check) => (
                <QualityItem check={check} key={check.id} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

function buildUpdateRunbook(
  importDraft: string,
  impact: ImportModelImpact | null,
  preview: ImportPreview | null,
  state: ImportState
): UpdateRunbookStep[] {
  const hasDraft = importDraft.trim().length > 0;
  const hasPreview = Boolean(preview);
  const hasImpact = Boolean(impact);
  const applied = state.kind === "success";

  return [
    {
      label: "准备数据源",
      detail: `${templateSourceItems.length} 个模板：赛程、排名、伤停、赔率、战绩、舆情。`,
      status: "done"
    },
    {
      label: "生成导入包",
      detail: hasDraft ? "导入框已有 JSON，可继续预检。" : "粘贴 JSON、上传文件，或先填入组合包示例。",
      status: hasDraft ? "done" : "current"
    },
    {
      label: "预检模型影响",
      detail: hasPreview && hasImpact ? "已生成字段变化和预测影响。" : "确认前先看比赛、球队和冠军概率变化。",
      status: hasPreview && hasImpact ? "done" : hasDraft ? "current" : "pending"
    },
    {
      label: "应用并保留回滚",
      detail: applied ? "本次导入已应用，历史区可恢复导入前状态。" : "预检通过后点击确认应用。",
      status: applied ? "done" : hasPreview ? "current" : "pending"
    }
  ];
}

function UpdateRunbookPanel({ steps }: { steps: UpdateRunbookStep[] }) {
  return (
    <section className="update-runbook" aria-label="每日数据更新流程">
      <div className="update-runbook__header">
        <div>
          <span className="eyebrow">更新流程</span>
          <strong>按这 4 步完成每日数据刷新</strong>
        </div>
        <span>{steps.filter((step) => step.status === "done").length}/{steps.length} 已完成</span>
      </div>
      <div className="update-runbook__steps">
        {steps.map((step, index) => (
          <article className={`update-runbook__step update-runbook__step--${step.status}`} key={step.label}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function buildUpdateWorkspaceItems({
  dynamicFeeds,
  importDraft,
  importHistoryCount,
  importPreview,
  importRecapHistoryCount,
  importState
}: {
  dynamicFeeds: number;
  importDraft: string;
  importHistoryCount: number;
  importPreview: ImportPreview | null;
  importRecapHistoryCount: number;
  importState: ImportState;
}): UpdateWorkspaceItem[] {
  const hasDraft = importDraft.trim().length > 0;

  return [
    {
      label: "导入操作",
      value: importPreview ? "待确认" : hasDraft ? "待预检" : "待输入",
      detail:
        importState.kind === "success"
          ? "最近一次导入已应用，继续看复盘和历史。"
          : importPreview
            ? "预检结果已生成，确认前先看风险摘要。"
            : hasDraft
              ? "JSON 已就绪，下一步做预检。"
              : "先上传或粘贴当天核验数据。",
      icon: "database",
      tone: importPreview || hasDraft ? "orange" : "blue"
    },
    {
      label: "复盘审计",
      value: `${importRecapHistoryCount}/8`,
      detail:
        importRecapHistoryCount > 0
          ? "可查看最近导入后的模型影响和字段变化。"
          : "应用一次导入后会自动保存复盘。",
      icon: "search",
      tone: importRecapHistoryCount > 0 ? "green" : "blue"
    },
    {
      label: "回滚恢复",
      value: `${importHistoryCount}/5`,
      detail:
        importHistoryCount > 0
          ? "保留导入前快照，可恢复旧预测状态。"
          : "确认导入后会生成回滚点。",
      icon: "shield",
      tone: importHistoryCount > 0 ? "green" : "blue"
    },
    {
      label: "模板准备",
      value: dynamicFeeds > 0 ? `${dynamicFeeds} 项待接` : "就绪",
      detail:
        dynamicFeeds > 0
          ? "排名、伤停、赔率等动态流先按模板手动更新。"
          : "当前动态数据流已全部接入。",
      icon: "git",
      tone: dynamicFeeds > 0 ? "orange" : "green"
    }
  ];
}

function UpdateWorkspaceMap({ items }: { items: UpdateWorkspaceItem[] }) {
  return (
    <section className="update-workspace-map" aria-label="数据更新工作区地图">
      <div className="update-workspace-map__header">
        <div>
          <span className="eyebrow">工作区地图</span>
          <strong>先操作，再审计，最后保留恢复路径</strong>
        </div>
        <span>每日更新视图</span>
      </div>
      <div className="update-workspace-map__grid">
        {items.map((item) => (
          <article className={`workspace-map-card workspace-map-card--${item.tone}`} key={item.label}>
            <span>
              <Icon name={item.icon} size={15} />
            </span>
            <div>
              <em>{item.label}</em>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AppliedImportRecapPanel({
  onDismiss,
  recap
}: {
  onDismiss: () => void;
  recap: ImportRecapEntry;
}) {
  const teamImpacts = recap.teamImpacts
    .filter((impact) => Math.abs(impact.deltaChampion) > 0 || Math.abs(impact.deltaRound16) > 0)
    .slice(0, 4);
  const matchImpacts = recap.matchImpacts.slice(0, 3);
  const resultChanges = recap.fixtureChanges
    .filter((change) =>
      change.fields.some((field) => field.field === "result" || field.field === "status")
    )
    .slice(0, 4);

  return (
    <section className="applied-recap" aria-label="导入后自动复盘">
      <div className="applied-recap__header">
        <div>
          <span className="eyebrow">导入复盘</span>
          <strong>{recap.summary.label}</strong>
          <p>
            {formatDateTime(recap.appliedAt)} · {recap.summary.importedResults} 条赛果 ·{" "}
            {recap.summary.importedTeams} 支球队
          </p>
        </div>
        <div className="applied-recap__actions">
          <button className="secondary-action" onClick={() => downloadImportRecap(recap, "txt")} type="button">
            <Icon name="database" size={14} />
            文本
          </button>
          <button className="secondary-action" onClick={() => downloadImportRecap(recap, "json")} type="button">
            <Icon name="database" size={14} />
            JSON
          </button>
          <button aria-label="关闭导入复盘" className="drawer-close" onClick={onDismiss} type="button">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      <div className="applied-recap__grid">
        <section className="applied-recap__section">
          <div className="preview-change-list__title">球队概率变化</div>
          {teamImpacts.length > 0 ? (
            <div className="applied-recap__list">
              {teamImpacts.map((item) => (
                <article className="impact-card" key={item.teamId}>
                  <strong>{item.label}</strong>
                  <span>
                    冠军 {percent(item.beforeChampion)} → {percent(item.afterChampion)}
                    <em className={item.deltaChampion >= 0 ? "is-up" : "is-down"}>
                      {formatProbabilityDelta(item.deltaChampion)}
                    </em>
                  </span>
                  <span>
                    16 强 {percent(item.beforeRound16)} → {percent(item.afterRound16)}
                    <em className={item.deltaRound16 >= 0 ? "is-up" : "is-down"}>
                      {formatProbabilityDelta(item.deltaRound16)}
                    </em>
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="applied-recap__empty">本次导入没有明显球队概率变化。</p>
          )}
        </section>

        <section className="applied-recap__section">
          <div className="preview-change-list__title">小组形势变化</div>
          {resultChanges.length > 0 ? (
            <div className="applied-recap__list">
              {resultChanges.map((change) => (
                <article className="applied-result-card" key={change.id}>
                  <strong>{change.label}</strong>
                  <div>
                    {change.fields
                      .filter((field) => field.field === "result" || field.field === "status")
                      .slice(0, 3)
                      .map((field) => (
                        <span key={`${change.id}-${field.field}`}>
                          {field.label}: {field.before} → {field.after}
                        </span>
                      ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="applied-recap__empty">本次导入没有新的比分或比赛状态变化。</p>
          )}
        </section>

        <section className="applied-recap__section">
          <div className="preview-change-list__title">后续比赛影响</div>
          {matchImpacts.length > 0 ? (
            <div className="applied-recap__list">
              {matchImpacts.map((item) => (
                <article className="impact-card" key={item.matchId}>
                  <strong>{item.label}</strong>
                  <span>
                    主胜 {percent(item.before.homeWin)} → {percent(item.after.homeWin)}
                    <em className={item.deltaHomeWin >= 0 ? "is-up" : "is-down"}>
                      {formatProbabilityDelta(item.deltaHomeWin)}
                    </em>
                  </span>
                  <span>
                    平局 {percent(item.before.draw)} → {percent(item.after.draw)}
                    <em className={item.deltaDraw >= 0 ? "is-up" : "is-down"}>
                      {formatProbabilityDelta(item.deltaDraw)}
                    </em>
                  </span>
                  <span>
                    客胜 {percent(item.before.awayWin)} → {percent(item.after.awayWin)}
                    <em className={item.deltaAwayWin >= 0 ? "is-up" : "is-down"}>
                      {formatProbabilityDelta(item.deltaAwayWin)}
                    </em>
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="applied-recap__empty">本次导入没有明显改变后续单场概率。</p>
          )}
        </section>
      </div>
    </section>
  );
}

function ImportRecapHistoryPanel({
  history,
  onClear,
  onInspect
}: {
  history: ImportRecapEntry[];
  onClear: () => void;
  onInspect: (entry: ImportRecapEntry) => void;
}) {
  return (
    <div className="import-recap-history">
      <div className="import-history__header">
        <div>
          <div className="subheading">复盘历史</div>
          <p>保存最近 8 次导入后的模型影响和字段变化，方便每日复核。</p>
        </div>
        <div className="history-panel-actions">
          <span>{history.length}/8</span>
          <button
            className="secondary-action"
            disabled={history.length === 0}
            onClick={() => downloadImportRecapHistory(history)}
            type="button"
          >
            导出全部
          </button>
          <button
            className="secondary-action"
            disabled={history.length === 0}
            onClick={onClear}
            type="button"
          >
            清空
          </button>
        </div>
      </div>

      {history.length > 0 ? (
        <div className="import-recap-history__list">
          {history.map((entry) => {
            const topTeamImpact = entry.teamImpacts[0];
            const topMatchImpact = entry.matchImpacts[0];

            return (
              <article className="import-recap-history__item" key={entry.id}>
                <div className="import-recap-history__body">
                  <strong>{entry.summary.label}</strong>
                  <p>
                    {formatDateTime(entry.appliedAt)} · {entry.summary.importedResults} 条赛果 ·{" "}
                    {entry.summary.importedTeams} 支球队
                  </p>
                  <div className="import-recap-history__signals">
                    <span>
                      {topTeamImpact
                        ? `${topTeamImpact.label} 冠军 ${formatProbabilityDelta(topTeamImpact.deltaChampion)}`
                        : "无明显球队变化"}
                    </span>
                    <span>
                      {topMatchImpact
                        ? `${topMatchImpact.label} 主胜 ${formatProbabilityDelta(topMatchImpact.deltaHomeWin)}`
                        : "无明显比赛变化"}
                    </span>
                  </div>
                </div>
                <div className="import-recap-history__actions">
                  <button className="secondary-action" onClick={() => onInspect(entry)} type="button">
                    查看
                  </button>
                  <button className="secondary-action" onClick={() => downloadImportRecap(entry, "txt")} type="button">
                    TXT
                  </button>
                  <button className="secondary-action" onClick={() => downloadImportRecap(entry, "json")} type="button">
                    JSON
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="import-history__empty">暂无复盘历史。确认应用导入后会自动保存。</div>
      )}
    </div>
  );
}

function downloadImportRecapHistory(history: ImportRecapEntry[]) {
  const exportedAt = new Date().toISOString();
  const payload = {
    exportedAt,
    count: history.length,
    entries: history.map(buildAppliedRecapExport)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `world-cup-2026-import-recap-history-${exportedAt.replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadImportRecap(recap: ImportRecapEntry, format: "json" | "txt") {
  const exportPayload = buildAppliedRecapExport(recap);
  const content =
    format === "json"
      ? JSON.stringify(exportPayload, null, 2)
      : serializeAppliedRecapText(exportPayload);
  const blob = new Blob([content], {
    type: format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = buildAppliedRecapFilename(recap.appliedAt, format);
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildAppliedRecapExport(recap: ImportRecapEntry) {
  return {
    exportedAt: new Date().toISOString(),
    appliedAt: recap.appliedAt,
    importSummary: recap.summary,
    sourceSnapshot: recap.sourceSnapshot,
    savedAt: recap.savedAt,
    sources: recap.sources.map((source) => ({
      id: source.id,
      label: source.label,
      kind: source.kind,
      status: source.status,
      url: source.url,
      updatedAt: source.updatedAt,
      coverage: source.coverage
    })),
    teamImpacts:
      recap.teamImpacts.map((item) => ({
        teamId: item.teamId,
        label: item.label,
        champion: {
          before: item.beforeChampion,
          after: item.afterChampion,
          delta: item.deltaChampion
        },
        round16: {
          before: item.beforeRound16,
          after: item.afterRound16,
          delta: item.deltaRound16
        }
      })),
    matchImpacts:
      recap.matchImpacts.map((item) => ({
        matchId: item.matchId,
        label: item.label,
        homeWin: {
          before: item.before.homeWin,
          after: item.after.homeWin,
          delta: item.deltaHomeWin
        },
        draw: {
          before: item.before.draw,
          after: item.after.draw,
          delta: item.deltaDraw
        },
        awayWin: {
          before: item.before.awayWin,
          after: item.after.awayWin,
          delta: item.deltaAwayWin
        }
      })),
    fixtureChanges: recap.fixtureChanges.map((change) => ({
      id: change.id,
      label: change.label,
      fields: change.fields
    })),
    teamChanges: recap.teamChanges.map((change) => ({
      id: change.id,
      label: change.label,
      fields: change.fields
    })),
    warnings: recap.warnings
  };
}

function serializeAppliedRecapText(payload: ReturnType<typeof buildAppliedRecapExport>): string {
  const lines = [
    `2026 世界杯导入复盘`,
    `导入时间: ${formatDateTime(payload.appliedAt)}`,
    `导入标签: ${payload.importSummary.label}`,
    `导入内容: ${payload.importSummary.importedFixtures} 场赛程，${payload.importSummary.importedResults} 条赛果，${payload.importSummary.importedDiscipline ?? 0} 条纪律，${payload.importSummary.importedTeams} 支球队`,
    "",
    "球队概率变化:"
  ];

  if (payload.teamImpacts.length > 0) {
    payload.teamImpacts.slice(0, 6).forEach((item) => {
      lines.push(
        `- ${item.label}: 冠军 ${percent(item.champion.before)} -> ${percent(item.champion.after)} (${formatProbabilityDelta(item.champion.delta)}), 16强 ${percent(item.round16.before)} -> ${percent(item.round16.after)} (${formatProbabilityDelta(item.round16.delta)})`
      );
    });
  } else {
    lines.push("- 无明显球队概率变化");
  }

  lines.push("", "比赛概率变化:");
  if (payload.matchImpacts.length > 0) {
    payload.matchImpacts.slice(0, 5).forEach((item) => {
      lines.push(
        `- ${item.label}: 主胜 ${formatProbabilityDelta(item.homeWin.delta)}, 平局 ${formatProbabilityDelta(item.draw.delta)}, 客胜 ${formatProbabilityDelta(item.awayWin.delta)}`
      );
    });
  } else {
    lines.push("- 无明显比赛概率变化");
  }

  lines.push("", "比分/状态变化:");
  const resultChanges = payload.fixtureChanges.filter((change) =>
    change.fields.some((field) => field.field === "result" || field.field === "status")
  );
  if (resultChanges.length > 0) {
    resultChanges.slice(0, 8).forEach((change) => {
      const fields = change.fields
        .filter((field) => field.field === "result" || field.field === "status")
        .map((field) => `${field.label}: ${field.before} -> ${field.after}`)
        .join("; ");
      lines.push(`- ${change.label}: ${fields}`);
    });
  } else {
    lines.push("- 无比分或状态变化");
  }

  lines.push("", "数据源:");
  payload.sources.forEach((source) => {
    lines.push(`- ${source.label} (${source.status}): ${source.coverage}`);
  });

  if (payload.warnings.length > 0) {
    lines.push("", "警告:");
    payload.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
}

function buildAppliedRecapFilename(appliedAt: string, format: "json" | "txt"): string {
  const stamp = appliedAt.replace(/[:.]/g, "-");

  return `world-cup-2026-import-recap-${stamp}.${format}`;
}

function buildDailyWorkflow(
  report: DataUpdateReport,
  snapshot: TournamentSnapshot,
  impact: ImportModelImpact | null
) {
  const openFixtures = snapshot.fixtures
    .filter((fixture) => fixture.status !== "completed")
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  const nextFixture = openFixtures[0];
  const failingChecks = report.qualityChecks.filter((check) => check.level === "fail");
  const warningChecks = report.qualityChecks.filter((check) => check.level === "warn");
  const blockedFeeds = report.feeds.filter((feed) => feed.status === "blocked");
  const plannedFeeds = report.feeds.filter(
    (feed) => feed.status === "planned" || feed.status === "placeholder"
  );
  const topTeamImpact = impact?.teamImpacts[0];
  const topMatchImpact = impact?.matchImpacts[0];
  const tasks: DailyWorkflowItem[] = [
    {
      label: "先核赛程/赛果",
      detail: nextFixture
        ? `${formatFixtureLabel(nextFixture, snapshot)} · ${formatDateTime(nextFixture.date)}`
        : "所有当前赛程均已完赛或没有待更新比赛。",
      tone: nextFixture ? "warn" : "ok"
    },
    {
      label: "补动态数据",
      detail:
        plannedFeeds.length > 0
          ? plannedFeeds.map((feed) => feed.label).slice(0, 3).join("、")
          : "动态数据流均为就绪状态。",
      tone: plannedFeeds.length > 0 ? "warn" : "ok"
    },
    {
      label: "处理质量风险",
      detail:
        failingChecks.length > 0
          ? failingChecks.map((check) => check.label).slice(0, 2).join("、")
          : warningChecks.length > 0
            ? warningChecks.map((check) => check.label).slice(0, 2).join("、")
            : "当前质量检查无失败或警告。",
      tone: failingChecks.length > 0 ? "danger" : warningChecks.length > 0 ? "warn" : "ok"
    },
    {
      label: "看模型变化",
      detail: topTeamImpact
        ? `${topTeamImpact.label} 冠军 ${formatProbabilityDelta(topTeamImpact.deltaChampion)}`
        : "预检导入后会显示受影响最大的球队和比赛。",
      tone: topTeamImpact ? "warn" : "ok"
    }
  ];

  return {
    blockedFeeds,
    nextFixture,
    plannedFeeds,
    tasks,
    topMatchImpact,
    topTeamImpact
  };
}

function DailyWorkflowPanel({
  workflow
}: {
  workflow: ReturnType<typeof buildDailyWorkflow>;
}) {
  return (
    <section className="daily-workflow" aria-label="每日数据更新工作流">
      <div className="daily-workflow__header">
        <div>
          <span className="eyebrow">每日工作流</span>
          <strong>先更新最会影响今日预测的输入</strong>
        </div>
        <span>{workflow.blockedFeeds.length > 0 ? "有受限数据源" : "可按模板更新"}</span>
      </div>
      <div className="daily-workflow__grid">
        {workflow.tasks.map((task) => (
          <article className={`daily-task daily-task--${task.tone}`} key={task.label}>
            <span>{task.label}</span>
            <strong>{task.detail}</strong>
          </article>
        ))}
      </div>
      <div className="daily-workflow__impact">
        <div>
          <span>导入后重点看</span>
          <strong>
            {workflow.topMatchImpact
              ? `${workflow.topMatchImpact.label} 主胜 ${formatProbabilityDelta(workflow.topMatchImpact.deltaHomeWin)}`
              : "预检模型影响"}
          </strong>
        </div>
        <div>
          <span>下一步动作</span>
          <strong>
            {workflow.plannedFeeds.length > 0
              ? `更新 ${workflow.plannedFeeds[0].label}`
              : "上传导入包并预检"}
          </strong>
        </div>
      </div>
    </section>
  );
}

function formatFixtureLabel(match: Match, snapshot: TournamentSnapshot): string {
  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);

  return `${home?.abbr ?? match.homeTeamId} vs ${away?.abbr ?? match.awayTeamId}`;
}

function StepHeader({
  description,
  index,
  title
}: {
  description: string;
  index: string;
  title: string;
}) {
  return (
    <div className="update-step__header">
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImportHistoryPanel({
  history,
  onClear,
  onRestore
}: {
  history: ImportHistoryEntry[];
  onClear: () => void;
  onRestore: (entryId: string) => void;
}) {
  return (
    <div className="import-history">
      <div className="import-history__header">
        <div>
          <div className="subheading">导入历史</div>
          <p>最近 5 次导入前状态会保存在本地，可用于快速回滚。</p>
        </div>
        <div className="history-panel-actions">
          <span>{history.length}/5</span>
          <button
            className="secondary-action"
            disabled={history.length === 0}
            onClick={onClear}
            type="button"
          >
            清空
          </button>
        </div>
      </div>

      {history.length > 0 ? (
        <div className="import-history__list">
          {history.map((entry) => (
            <article className="import-history__item" key={entry.id}>
              <div>
                <strong>{entry.summary.label}</strong>
                <p>
                  导入前版本 · {formatDateTime(entry.createdAt)} ·{" "}
                  {formatDateTime(entry.snapshot.collectedAt)}
                </p>
                <div className="import-history__counts">
                  <span>{entry.summary.importedFixtures} 场赛程</span>
                  <span>{entry.summary.importedResults} 条赛果</span>
                  <span>{entry.summary.importedDiscipline ?? 0} 条纪律</span>
                  <span>{entry.summary.importedTeams} 支球队</span>
                </div>
              </div>
              <button
                className="secondary-action"
                onClick={() => onRestore(entry.id)}
                type="button"
              >
                <Icon name="refresh" size={15} />
                恢复
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="import-history__empty">暂无导入历史。确认应用一次导入后会生成回滚点。</div>
      )}
    </div>
  );
}

function ImportPreviewPanel({
  impact,
  preview
}: {
  impact: ImportModelImpact | null;
  preview: ImportPreview;
}) {
  const fixtureChanges = preview.fixtureChanges.slice(0, 5);
  const teamChanges = preview.teamChanges.slice(0, 5);
  const hiddenFixtures = Math.max(0, preview.fixtureChanges.length - fixtureChanges.length);
  const hiddenTeams = Math.max(0, preview.teamChanges.length - teamChanges.length);
  const auditSummary = buildPreviewAuditSummary(preview, impact);

  return (
    <div className="import-preview">
      <div className="import-preview__header">
        <div>
          <div className="subheading">导入预检</div>
          <strong>{preview.summary.label}</strong>
        </div>
        <div className="import-preview__counts">
          <span>{preview.summary.importedFixtures} 场赛程</span>
          <span>{preview.summary.importedResults} 条赛果</span>
          <span>{preview.summary.importedDiscipline ?? 0} 条纪律</span>
          <span>{preview.summary.importedTeams} 支球队</span>
        </div>
      </div>

      <PreviewAuditPanel summary={auditSummary} warnings={preview.summary.warnings} />

      <div className="import-preview__grid">
        <PreviewChangeList
          changes={fixtureChanges}
          emptyLabel="没有比赛字段变化"
          hiddenCount={hiddenFixtures}
          title="比赛变化"
        />
        <PreviewChangeList
          changes={teamChanges}
          emptyLabel="没有球队字段变化"
          hiddenCount={hiddenTeams}
          title="球队变化"
        />
      </div>

      {impact ? <ImportImpactPanel impact={impact} /> : null}
    </div>
  );
}

function buildPreviewAuditSummary(
  preview: ImportPreview,
  impact: ImportModelImpact | null
): PreviewAuditSummary {
  const changedFixtureCount = preview.fixtureChanges.length;
  const changedTeamCount = preview.teamChanges.length;
  const changedFieldCount = [...preview.fixtureChanges, ...preview.teamChanges].reduce(
    (sum, change) => sum + change.fields.length,
    0
  );
  const maxTeamImpact = impact
    ? Math.max(...impact.teamImpacts.map((item) => Math.abs(item.deltaChampion)), 0)
    : 0;
  const maxMatchImpact = impact
    ? Math.max(
        ...impact.matchImpacts.map((item) =>
          Math.max(
            Math.abs(item.deltaHomeWin),
            Math.abs(item.deltaDraw),
            Math.abs(item.deltaAwayWin)
          )
        ),
        0
      )
    : 0;
  const maxImpact = Math.max(maxTeamImpact, maxMatchImpact);
  const hasWarnings = preview.summary.warnings.length > 0;
  const level: PreviewAuditSummary["level"] =
    hasWarnings || maxImpact >= 0.08 || changedFieldCount >= 18
      ? "risk"
      : maxImpact >= 0.035 || changedFieldCount >= 8
        ? "warn"
        : "pass";

  return {
    level,
    title:
      level === "risk"
        ? "需要人工复核"
        : level === "warn"
          ? "建议检查后应用"
          : "预检通过",
    detail:
      level === "risk"
        ? "这包数据变化较大或存在警告，应用前先核对来源、赛程 ID 和模型影响。"
        : level === "warn"
          ? "变化规模中等，建议重点看下方最大影响项。"
          : "变化规模较小，当前未发现明显导入风险。",
    tiles: [
      {
        label: "比赛变化",
        value: String(changedFixtureCount),
        detail: `${preview.summary.importedResults} 条赛果，${preview.summary.importedDiscipline ?? 0} 条纪律`
      },
      {
        label: "球队变化",
        value: String(changedTeamCount),
        detail: `${preview.summary.importedTeams} 支球队字段会更新`
      },
      {
        label: "字段变化",
        value: String(changedFieldCount),
        detail: "用于判断导入规模"
      },
      {
        label: "最大影响",
        value: percent(maxImpact),
        detail: impact ? `${impact.iterations.toLocaleString("zh-CN")} 次轻量模拟` : "未生成模型影响"
      }
    ]
  };
}

function PreviewAuditPanel({
  summary,
  warnings
}: {
  summary: PreviewAuditSummary;
  warnings: string[];
}) {
  return (
    <section className={`preview-audit preview-audit--${summary.level}`} aria-label="导入审核摘要">
      <div className="preview-audit__verdict">
        <span>{summary.level === "pass" ? "通过" : summary.level === "warn" ? "检查" : "复核"}</span>
        <div>
          <strong>{summary.title}</strong>
          <p>{summary.detail}</p>
        </div>
      </div>
      <div className="preview-audit__tiles">
        {summary.tiles.map((tile) => (
          <div className="preview-audit__tile" key={tile.label}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <em>{tile.detail}</em>
          </div>
        ))}
      </div>
      {warnings.length > 0 ? (
        <div className="preview-audit__warnings">
          {warnings.slice(0, 3).map((warning) => (
            <p key={warning}>
              <Icon name="alert" size={14} />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ImportImpactPanel({ impact }: { impact: ImportModelImpact }) {
  return (
    <div className="import-impact">
      <div className="import-impact__header">
        <div>
          <div className="subheading">模型影响预估</div>
          <p>{impact.iterations.toLocaleString("zh-CN")} 次固定种子轻量模拟</p>
        </div>
      </div>

      <div className="import-impact__grid">
        <section className="impact-list">
          <div className="preview-change-list__title">关键球队</div>
          {impact.teamImpacts.slice(0, 4).map((item) => (
            <article className="impact-card" key={item.teamId}>
              <strong>{item.label}</strong>
              <span>
                冠军 {percent(item.beforeChampion)} → {percent(item.afterChampion)}
                <em className={item.deltaChampion >= 0 ? "is-up" : "is-down"}>
                  {formatProbabilityDelta(item.deltaChampion)}
                </em>
              </span>
              <span>
                16 强 {percent(item.beforeRound16)} → {percent(item.afterRound16)}
                <em className={item.deltaRound16 >= 0 ? "is-up" : "is-down"}>
                  {formatProbabilityDelta(item.deltaRound16)}
                </em>
              </span>
            </article>
          ))}
        </section>

        <section className="impact-list">
          <div className="preview-change-list__title">比赛胜平负</div>
          {impact.matchImpacts.slice(0, 3).map((item) => (
            <article className="impact-card" key={item.matchId}>
              <strong>{item.label}</strong>
              <span>
                主胜 {percent(item.before.homeWin)} → {percent(item.after.homeWin)}
                <em className={item.deltaHomeWin >= 0 ? "is-up" : "is-down"}>
                  {formatProbabilityDelta(item.deltaHomeWin)}
                </em>
              </span>
              <span>
                平局 {percent(item.before.draw)} → {percent(item.after.draw)}
                <em className={item.deltaDraw >= 0 ? "is-up" : "is-down"}>
                  {formatProbabilityDelta(item.deltaDraw)}
                </em>
              </span>
              <span>
                客胜 {percent(item.before.awayWin)} → {percent(item.after.awayWin)}
                <em className={item.deltaAwayWin >= 0 ? "is-up" : "is-down"}>
                  {formatProbabilityDelta(item.deltaAwayWin)}
                </em>
              </span>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

function formatProbabilityDelta(value: number): string {
  const sign = value >= 0 ? "+" : "";

  return `${sign}${percent(value)}`;
}

function PreviewChangeList({
  changes,
  emptyLabel,
  hiddenCount,
  title
}: {
  changes: ImportPreview["fixtureChanges"];
  emptyLabel: string;
  hiddenCount: number;
  title: string;
}) {
  return (
    <section className="preview-change-list">
      <div className="preview-change-list__title">{title}</div>
      {changes.length > 0 ? (
        <div className="preview-change-list__items">
          {changes.map((change) => (
            <article className="preview-change-card" key={change.id}>
              <strong>{change.label}</strong>
              <div>
                {change.fields.slice(0, 4).map((field) => (
                  <span key={`${change.id}-${field.field}`}>
                    {field.label}: {field.before} → {field.after}
                  </span>
                ))}
                {change.fields.length > 4 ? <em>另 {change.fields.length - 4} 项</em> : null}
              </div>
            </article>
          ))}
          {hiddenCount > 0 ? <p>另 {hiddenCount} 项未显示</p> : null}
        </div>
      ) : (
        <p className="preview-change-list__empty">{emptyLabel}</p>
      )}
    </section>
  );
}

function FeedCard({ feed }: { feed: DataFeedResult; key?: string }) {
  return (
    <article className={`feed-card feed-card--${feed.status}`}>
      <span className="feed-card__icon">
        <Icon name={statusIcons[feed.status]} size={15} />
      </span>
      <div>
        <div className="feed-card__title">
          <strong>{feed.label}</strong>
          <em>{statusLabels[feed.status]}</em>
        </div>
        <p>{feed.message}</p>
        <span>
          {feed.records.toLocaleString("zh-CN")} 条 · {formatDateTime(feed.updatedAt)}
        </span>
      </div>
    </article>
  );
}

function QualityItem({ check }: { check: DataQualityCheck; key?: string }) {
  return (
    <article className={`quality-item quality-item--${check.level}`}>
      <div>
        <strong>{check.label}</strong>
        <p>{check.detail}</p>
      </div>
      <span>
        <em>{check.actual}</em>
        <small>目标 {check.expected}</small>
      </span>
    </article>
  );
}
