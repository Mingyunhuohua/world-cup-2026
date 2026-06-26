import { useMemo } from "react";
import { defaultModelConfig } from "../model/config.ts";
import type { ModelConfig } from "../types.ts";

type WeightRadarProps = {
  config: ModelConfig;
};

type RadarAxis = {
  key: keyof ModelConfig;
  label: string;
  min: number;
  max: number;
};

const axes: RadarAxis[] = [
  { key: "eloWeight", label: "ELO", min: 0.2, max: 1.6 },
  { key: "rankWeight", label: "FIFA", min: 0, max: 1.2 },
  { key: "formWeight", label: "近期状态", min: 0, max: 1.2 },
  { key: "injuryWeight", label: "伤停", min: 0, max: 1.2 },
  { key: "penaltyStrengthWeight", label: "点球", min: 0, max: 1 }
];

const CENTER = 110;
const RADIUS = 78;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalize(axis: RadarAxis, config: ModelConfig): number {
  const raw = Number(config[axis.key] ?? 0);
  return clamp01((raw - axis.min) / (axis.max - axis.min));
}

function pointFor(index: number, fraction: number): [number, number] {
  const angle = (-90 + index * (360 / axes.length)) * (Math.PI / 180);
  return [
    CENTER + RADIUS * fraction * Math.cos(angle),
    CENTER + RADIUS * fraction * Math.sin(angle)
  ];
}

function toPolygon(fractions: number[]): string {
  return fractions.map((fraction, index) => pointFor(index, fraction).join(",")).join(" ");
}

export function WeightRadar({ config }: WeightRadarProps) {
  const current = useMemo(() => axes.map((axis) => normalize(axis, config)), [config]);
  const baseline = useMemo(
    () => axes.map((axis) => normalize(axis, defaultModelConfig)),
    []
  );

  const ring100 = toPolygon(axes.map(() => 1));
  const ring050 = toPolygon(axes.map(() => 0.5));
  const currentPolygon = toPolygon(current);
  const baselinePolygon = toPolygon(baseline);
  const deviates = current.some((value, index) => Math.abs(value - baseline[index]) > 0.001);

  return (
    <section className="panel weight-radar-panel" aria-label="模型权重雷达">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">权重画像</span>
          <h2>当前模型的权重雷达</h2>
        </div>
        <span className="table-meta">{deviates ? "已偏离默认配置" : "均衡模型（默认）"}</span>
      </div>
      <div className="weight-radar">
        <svg viewBox="0 0 220 220" role="img" aria-label="模型权重雷达图，展示 ELO、FIFA 排名、近期状态、伤停、点球各项权重的相对强度">
          <polygon className="weight-radar__ring" points={ring100} />
          <polygon className="weight-radar__ring" points={ring050} />
          {axes.map((axis, index) => {
            const [x, y] = pointFor(index, 1);
            return (
              <line className="weight-radar__spoke" key={axis.key} x1={CENTER} y1={CENTER} x2={x} y2={y} />
            );
          })}
          {deviates ? (
            <polygon className="weight-radar__baseline" points={baselinePolygon} />
          ) : null}
          <polygon className="weight-radar__value" points={currentPolygon} />
          {current.map((fraction, index) => {
            const [x, y] = pointFor(index, fraction);
            return <circle className="weight-radar__dot" cx={x} cy={y} key={axes[index].key} r={2.6} />;
          })}
          {axes.map((axis, index) => {
            const [x, y] = pointFor(index, 1.16);
            return (
              <text
                className="weight-radar__label"
                key={`label-${axis.key}`}
                x={x}
                y={y}
                textAnchor={x > CENTER + 6 ? "start" : x < CENTER - 6 ? "end" : "middle"}
              >
                {axis.label}
              </text>
            );
          })}
        </svg>
        <ul className="weight-radar__legend">
          {axes.map((axis) => (
            <li key={axis.key}>
              <span>{axis.label === "ELO" ? "ELO 权重" : axis.label === "FIFA" ? "FIFA 排名" : axis.label === "点球" ? "点球强度" : axis.label}</span>
              <strong>{Number(config[axis.key] ?? 0).toFixed(2)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
