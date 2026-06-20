import type { Match, ModelConfig, Team } from "../types.ts";
import { defaultModelConfig } from "../model/config.ts";
import { buildParameterInsights } from "../model/insights.ts";
import {
  countChangedConfigKeys,
  getPresetIdForConfig,
  modelPresets,
  type ModelPresetId
} from "../model/presets.ts";
import { Icon } from "./Icon.tsx";

type ModelControlPanelProps = {
  config: ModelConfig;
  hasPersistedConfig: boolean;
  message: string;
  savedAt?: string;
  selectedMatch: Match;
  teamsById: Map<string, Team>;
  onConfigChange: (config: ModelConfig) => void;
  onConfigClear: () => void;
  onConfigExport: () => void;
  onConfigImport: (jsonText: string) => void;
  onConfigSave: () => void;
  onPresetChange: (presetId: ModelPresetId) => void;
  onReset: () => void;
};

type NumericControl = {
  key: keyof ModelConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  help: string;
};

const controls: NumericControl[] = [
  {
    key: "eloWeight",
    label: "ELO 权重",
    min: 0.2,
    max: 1.6,
    step: 0.05,
    help: "决定基础实力差距对进球期望和胜率的影响。"
  },
  {
    key: "rankWeight",
    label: "FIFA 排名",
    min: 0,
    max: 1.2,
    step: 0.05,
    help: "排名先验越高，长期强队的保护越明显。"
  },
  {
    key: "formWeight",
    label: "近期状态",
    min: 0,
    max: 1.2,
    step: 0.05,
    help: "让最近表现更快反映到单场预测里。"
  },
  {
    key: "injuryWeight",
    label: "伤停权重",
    min: 0,
    max: 1.2,
    step: 0.05,
    help: "关键伤停和阵容完整度的惩罚强度。"
  },
  {
    key: "suspensionRiskWeight",
    label: "停赛风险",
    min: 0,
    max: 0.24,
    step: 0.01,
    help: "小组赛纪律扣分较多时，对淘汰赛阵容完整度的附加惩罚。"
  },
  {
    key: "hostBoost",
    label: "东道主修正",
    min: 0,
    max: 0.18,
    step: 0.01,
    suffix: "xG",
    help: "美国、加拿大、墨西哥比赛的主办地增益。"
  },
  {
    key: "restDaysWeight",
    label: "休息天数",
    min: 0,
    max: 0.12,
    step: 0.01,
    help: "按相对休息差、短休疲劳和恢复收益修正进球期望。"
  },
  {
    key: "dixonColesRho",
    label: "低比分修正",
    min: -0.16,
    max: 0.04,
    step: 0.01,
    help: "调整 0-0、1-0、0-1、1-1 等比分的相关性。"
  },
  {
    key: "baseGoals",
    label: "基准进球",
    min: 1,
    max: 1.7,
    step: 0.02,
    suffix: "xG",
    help: "全赛事平均进球环境，影响大比分与平局概率。"
  },
  {
    key: "extraTimeGoalRate",
    label: "加时进球率",
    min: 0.15,
    max: 0.45,
    step: 0.01,
    help: "淘汰赛 90 分钟打平后，加时 30 分钟相对常规时间的进球率。"
  },
  {
    key: "penaltyStrengthWeight",
    label: "点球强度",
    min: 0,
    max: 1,
    step: 0.05,
    help: "淘汰赛点球阶段对强队的倾斜程度。"
  }
];

const coreControls = controls.filter((control) =>
  ["eloWeight", "rankWeight", "formWeight", "injuryWeight"].includes(control.key)
);
const advancedControls = controls.filter((control) => !coreControls.includes(control));
const iterationOptions = [1000, 5000, 10000, 25000];

export function ModelControlPanel({
  config,
  hasPersistedConfig,
  message,
  savedAt,
  selectedMatch,
  teamsById,
  onConfigClear,
  onConfigChange,
  onConfigExport,
  onConfigImport,
  onConfigSave,
  onPresetChange,
  onReset
}: ModelControlPanelProps) {
  const selectedPreset = getPresetIdForConfig(config);
  const changedKeys = countChangedConfigKeys(config);
  const insights = buildParameterInsights(selectedMatch, teamsById, config);
  const leadingInsight = insights[0];

  function updateNumber(key: keyof ModelConfig, value: number) {
    onConfigChange({
      ...config,
      [key]: value
    });
  }

  return (
    <section className="panel model-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">模型参数</span>
          <h2>权重与预设</h2>
        </div>
        <span className={changedKeys === 0 ? "model-drift" : "model-drift is-custom"}>
          {changedKeys === 0 ? "默认" : `${changedKeys} 项调整`}
        </span>
      </div>

      <div className="model-workspace">
        <div className="model-workspace__main">
          <div className="model-status-grid" aria-label="模型参数状态">
            <ModelStatusCard
              label="当前策略"
              tone={selectedPreset === "custom" ? "orange" : "green"}
              value={
                selectedPreset === "custom"
                  ? "自定义"
                  : modelPresets.find((preset) => preset.id === selectedPreset)?.label ?? "默认"
              }
              detail={changedKeys === 0 ? "参数未偏离默认配置" : `${changedKeys} 项参数已调整`}
            />
            <ModelStatusCard
              label="模拟规模"
              tone={config.simulationIterations >= 10000 ? "green" : "orange"}
              value={config.simulationIterations.toLocaleString("zh-CN")}
              detail={config.simulationIterations >= 10000 ? "适合正式查看" : "适合快速调参"}
            />
            <ModelStatusCard
              label="本地保存"
              tone={hasPersistedConfig ? "green" : "orange"}
              value={hasPersistedConfig ? "已保存" : "未保存"}
              detail={savedAt ? `最近 ${new Date(savedAt).toLocaleDateString("zh-CN")}` : "刷新后可能丢失当前权重"}
            />
            <ModelStatusCard
              label="敏感项"
              tone={leadingInsight ? "blue" : "green"}
              value={leadingInsight?.label ?? "暂无"}
              detail={leadingInsight ? `${leadingInsight.direction} ${leadingInsight.value.toFixed(1)}` : "当前比赛缺少敏感项"}
            />
          </div>

          <section className="model-section model-section--preset">
            <ModelSectionHeader
              description="先选一个策略基线，再按当前判断微调。"
              title="预设策略"
            />
            <label className="preset-select">
              <span>策略预设</span>
              <select
                value={selectedPreset}
                onChange={(event: { target: { value: string } }) => {
                  const next = event.target.value;
                  if (next !== "custom") {
                    onPresetChange(next as ModelPresetId);
                  }
                }}
              >
                {modelPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">自定义参数</option>
              </select>
              <small>
                {selectedPreset === "custom"
                  ? "当前参数已偏离预设，可继续细调或重置。"
                  : modelPresets.find((preset) => preset.id === selectedPreset)?.description}
              </small>
            </label>
            <div className="preset-actions">
              <label>
                模拟次数
                <select
                  value={config.simulationIterations}
                  onChange={(event: { target: { value: string } }) =>
                    updateNumber("simulationIterations", Number(event.target.value))
                  }
                >
                  {iterationOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.toLocaleString("zh-CN")}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary-action" onClick={onReset} type="button">
                <Icon name="refresh" size={15} />
                重置
              </button>
            </div>
          </section>

          <section className="model-section">
            <ModelSectionHeader
              description="决定球队长期实力、排名、状态和伤停如何进入单场胜率。"
              title="核心权重"
            />
            <ModelControlList controls={coreControls} config={config} onUpdate={updateNumber} />
          </section>

          <section className="model-section">
            <ModelSectionHeader
              description="控制主办地、休息差、低比分、进球环境、加时赛和点球阶段的修正。"
              title="高级修正"
            />
            <ModelControlList controls={advancedControls} config={config} onUpdate={updateNumber} />
          </section>
        </div>

        <aside className="model-workspace__side">
          <section className="model-section model-section--management">
            <ModelSectionHeader
              description="保存后刷新页面仍会保留，也可以导出 JSON 复用。"
              title="参数管理"
            />
            <div className="model-persistence">
              <div>
                <strong>{hasPersistedConfig ? "本地参数已保存" : "本地参数未保存"}</strong>
                <span>
                  {savedAt
                    ? `保存于 ${new Date(savedAt).toLocaleString("zh-CN")}`
                    : "保存后刷新页面仍会保留当前权重。"}
                </span>
              </div>
              <div className="model-persistence__actions">
                <button className="secondary-action" onClick={onConfigSave} type="button">
                  <Icon name="database" size={15} />
                  保存
                </button>
                <button className="secondary-action" onClick={onConfigExport} type="button">
                  <Icon name="database" size={15} />
                  导出
                </button>
                <label className="model-import-button">
                  <Icon name="database" size={15} />
                  导入
                  <input
                    accept=".json,application/json"
                    onChange={async (event: { target: { files?: FileList | null; value?: string } }) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        return;
                      }

                      onConfigImport(await file.text());
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
                <button className="secondary-action" onClick={onConfigClear} type="button">
                  <Icon name="x" size={15} />
                  清除
                </button>
              </div>
              {message ? <p>{message}</p> : null}
            </div>
          </section>

          <section className="model-section model-section--insights">
            <ModelSectionHeader
              description="显示当前选中比赛对哪些参数最敏感。"
              title="敏感项"
            />
            <div className="insight-box">
              <div className="insight-list">
                {insights.map((insight) => (
                  <div className="insight-item" key={insight.label}>
                    <div>
                      <strong>{insight.label}</strong>
                      <p>{insight.description}</p>
                    </div>
                    <span>
                      {insight.direction}
                      <em>{insight.value.toFixed(1)}</em>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function ModelStatusCard({
  detail,
  label,
  tone,
  value
}: {
  detail: string;
  label: string;
  tone: "blue" | "green" | "orange";
  value: string;
}) {
  return (
    <article className={`model-status-card model-status-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ModelSectionHeader({
  description,
  title
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="model-section__header">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ModelControlList({
  config,
  controls,
  onUpdate
}: {
  config: ModelConfig;
  controls: NumericControl[];
  onUpdate: (key: keyof ModelConfig, value: number) => void;
}) {
  return (
    <div className="model-control-list">
      {controls.map((control) => {
        const value = config[control.key];
        const defaultValue = defaultModelConfig[control.key];

        return (
          <label className="model-control" key={control.key}>
            <span className="model-control__header">
              <span>{control.label}</span>
              <strong>
                {value.toFixed(control.step < 0.05 ? 2 : 2)}
                {control.suffix ? ` ${control.suffix}` : ""}
              </strong>
            </span>
            <input
              aria-label={control.label}
              max={control.max}
              min={control.min}
              onChange={(event: { target: { value: string } }) =>
                onUpdate(control.key, Number(event.target.value))
              }
              step={control.step}
              type="range"
              value={value}
            />
            <span className="model-control__footer">
              <span>{control.help}</span>
              <em>
                默认 {defaultValue.toFixed(control.step < 0.05 ? 2 : 2)}
                {control.suffix ? ` ${control.suffix}` : ""}
              </em>
            </span>
          </label>
        );
      })}
    </div>
  );
}
