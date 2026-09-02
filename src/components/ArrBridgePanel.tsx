import { VegaLiteChart } from './VegaLiteChart';
import { buildArrBridgeSpec, type PaletteColors } from '../lib/vegaSpecs';
import type { ArrBridgePoint } from '../lib/metrics';

interface Props {
  points: ArrBridgePoint[];
  colors: PaletteColors;
  knobs: { positiveColor: string; negativeColor: string; barWidth: number };
}

export function ArrBridgePanel({ points, colors, knobs }: Props) {
  const spec = buildArrBridgeSpec(points, colors, knobs);
  const startM = (points[0].priorCum / 1_000_000).toFixed(2);
  const endM = (points[points.length - 1].newCum / 1_000_000).toFixed(2);

  return (
    <div className="card">
      <p className="panel-title">ARR bridge</p>
      <p className="panel-sub">Net new ARR by month — floating from ${startM}M to ${endM}M</p>
      <VegaLiteChart spec={spec} />
      <div className="legend">
        <span className="item"><span className="sw" style={{ background: knobs.positiveColor }} />Net growth month</span>
        <span className="item"><span className="sw" style={{ background: knobs.negativeColor }} />Net decline month</span>
      </div>
    </div>
  );
}
