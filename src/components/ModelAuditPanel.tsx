import type { ModelConfig, SimulationSummary, TournamentSnapshot } from "../types.ts";
import { activeKnockoutRuleSet } from "../model/tournamentRules.ts";
import {
  countChangedConfigKeys,
  getPresetIdForConfig,
  modelPresets
} from "../model/presets.ts";
import { compactNumber, formatDateTime } from "../utils/format.ts";
import { Icon } from "./Icon.tsx";

type ModelAuditPanelProps = {
  modelConfig: ModelConfig;
  simulation: SimulationSummary;
  snapshot: TournamentSnapshot;
};

const pipelineSteps = [
  {
    label: "数据快照",
    detail: "球队评分、赛程、赛果、伤停和动态字段进入运行态快照。"
  },
  {
    label: "单场模型",
    detail: "ELO/FIFA/状态/伤停/赛程恢复修正进球期望，再用泊松矩阵聚合胜平负。"
  },
  {
    label: "小组规则",
    detail: "真实赛果优先，未赛比赛用模型概率抽样，按积分和同分规则排序。"
  },
  {
    label: "全程模拟",
    detail: "固定随机种子运行蒙特卡洛，统计各队晋级各轮与夺冠概率。"
  }
];

export function ModelAuditPanel({
  modelConfig,
  simulation,
  snapshot
}: ModelAuditPanelProps) {
  const presetId = getPresetIdForConfig(modelConfig);
  const presetLabel =
    presetId === "custom"
      ? "自定义参数"
      : modelPresets.find((preset) => preset.id === presetId)?.label ?? "未知预设";
  const changedKeys = countChangedConfigKeys(modelConfig);
  const activeSources = snapshot.sources.filter((source) => source.status === "active").length;
  const fallbackSources = snapshot.sources.filter((source) => source.status !== "active").length;
  const limitations = [
    activeKnockoutRuleSet.source === "placeholder"
      ? activeKnockoutRuleSet.notes
      : "淘汰赛对位规则已使用官方映射。",
    fallbackSources > 0
      ? `${fallbackSources} 个数据源处于兜底或计划状态，动态数据仍依赖导入包更新。`
      : "当前快照的数据源均标记为启用。",
    "伤停、赔率、近期战绩和舆情尚未启用每日自动联网任务，当前 MVP 以可导入数据包为准。"
  ];

  return (
    <section className="panel audit-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">模型审计</span>
          <h2>算法链路与限制</h2>
        </div>
      </div>

      <div className="audit-metrics" aria-label="模型审计摘要">
        <AuditMetric label="快照" value={snapshot.label} />
        <AuditMetric label="采集" value={formatDateTime(snapshot.collectedAt)} />
        <AuditMetric label="预设" value={presetLabel} />
        <AuditMetric label="参数变更" value={`${changedKeys} 项`} />
        <AuditMetric label="模拟" value={`${compactNumber(simulation.iterations)} 次`} />
        <AuditMetric label="随机种子" value={simulation.seed} />
        <AuditMetric
          label="赛制规则"
          tone={activeKnockoutRuleSet.source === "placeholder" ? "warn" : "ok"}
          value={activeKnockoutRuleSet.source === "placeholder" ? "占位" : "官方"}
        />
        <AuditMetric label="数据源" value={`${activeSources}/${snapshot.sources.length} 启用`} />
      </div>

      <div className="audit-pipeline">
        {pipelineSteps.map((step, index) => (
          <article className="audit-step" key={step.label}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="audit-limitations">
        <div className="subheading">当前限制</div>
        {limitations.map((limitation) => (
          <p key={limitation}>
            <Icon name="alert" size={14} />
            <span>{limitation}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

function AuditMetric({
  label,
  tone,
  value
}: {
  label: string;
  tone?: "ok" | "warn";
  value: number | string;
}) {
  return (
    <div className={tone ? `audit-metric audit-metric--${tone}` : "audit-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
