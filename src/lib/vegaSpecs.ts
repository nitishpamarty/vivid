import type { TopLevelSpec } from 'vega-lite';
import type { ArrBridgePoint } from './metrics';

export interface PaletteColors {
  good: string;
  critical: string;
  brand: string;
  gridline: string;
  inkSecondary: string;
  inkPrimary: string;
}

export function buildArrBridgeSpec(
  points: ArrBridgePoint[],
  colors: PaletteColors,
  knobs: { positiveColor: string; negativeColor: string; barWidth: number } = { positiveColor: colors.good, negativeColor: colors.critical, barWidth: 0.62 },
): TopLevelSpec {
  const order = points.map((p) => p.label);
  const first = points[0];
  const last = points[points.length - 1];
  const startLabel = { label: first.label, value: first.priorCum, text: `$${(first.priorCum / 1_000_000).toFixed(2)}M` };
  const endLabel = { label: last.label, value: last.newCum, text: `$${(last.newCum / 1_000_000).toFixed(2)}M` };

  return {
    width: 'container',
    height: 210,
    background: 'transparent',
    config: { font: 'IBM Plex Sans' },
    layer: [
      {
        data: { values: points },
        mark: { type: 'bar', cornerRadius: 2, width: { band: knobs.barWidth } },
        encoding: {
          x: { field: 'label', type: 'ordinal', sort: order, axis: { domain: false, ticks: false, grid: false, labelColor: colors.inkSecondary, labelFontSize: 10, title: null } },
          y: { field: 'priorCum', type: 'quantitative', axis: null, scale: { zero: false } },
          y2: { field: 'newCum' },
          color: {
            field: 'positive', type: 'nominal',
            scale: { domain: [true, false], range: [knobs.positiveColor, knobs.negativeColor] },
            legend: null,
          },
        },
      },
      {
        data: { values: [startLabel] },
        mark: { type: 'text', dy: -14, fontSize: 11, font: 'IBM Plex Mono', align: 'left' },
        encoding: {
          x: { field: 'label', type: 'ordinal', sort: order },
          y: { field: 'value', type: 'quantitative' },
          text: { field: 'text' },
          color: { value: colors.inkSecondary },
        },
      },
      {
        data: { values: [endLabel] },
        mark: { type: 'text', dy: -14, fontSize: 11, font: 'IBM Plex Mono', align: 'right' },
        encoding: {
          x: { field: 'label', type: 'ordinal', sort: order },
          y: { field: 'value', type: 'quantitative' },
          text: { field: 'text' },
          color: { value: colors.inkPrimary },
        },
      },
    ],
  };
}

export function buildMiniLineSpec(months: string[], values: number[], color: string, gridline: string): TopLevelSpec {
  const data = months.map((m, i) => ({ month: m, value: values[i] }));
  return {
    width: 'container',
    height: 'container',
    background: 'transparent',
    data: { values: data },
    encoding: { x: { field: 'month', type: 'ordinal', sort: months, axis: null } },
    layer: [
      {
        mark: { type: 'line', point: false, interpolate: 'monotone', strokeWidth: 2 },
        encoding: {
          y: { field: 'value', type: 'quantitative', scale: { zero: false }, axis: { domain: false, ticks: false, labels: false, title: null, gridColor: gridline, grid: true, tickCount: 3 } },
          color: { value: color },
        },
      },
      {
        transform: [{ filter: { field: 'month', equal: months[months.length - 1] } }],
        mark: { type: 'point', filled: true, size: 40 },
        encoding: {
          y: { field: 'value', type: 'quantitative' },
          color: { value: color },
        },
      },
    ],
    config: { font: 'IBM Plex Sans', view: { stroke: null } },
  };
}
