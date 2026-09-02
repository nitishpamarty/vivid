import { VegaLiteChart } from './VegaLiteChart';
import { buildMiniLineSpec } from '../lib/vegaSpecs';

interface Props {
  nrrMonths: string[];
  nrrSeries: number[];
  churnMonths: string[];
  churnSeries: number[];
  nrrColor: string;
  churnColor: string;
  gridline: string;
}

export function RetentionPanel({ nrrMonths, nrrSeries, churnMonths, churnSeries, nrrColor, churnColor, gridline }: Props) {
  const nrrSpec = buildMiniLineSpec(nrrMonths, nrrSeries, nrrColor, gridline);
  const churnSpec = buildMiniLineSpec(churnMonths, churnSeries, churnColor, gridline);

  return (
    <div className="card">
      <p className="panel-title">Retention</p>
      <p className="panel-sub">NRR and logo churn, trailing months</p>
      <div className="retention-split">
        <div>
          <div className="mini-head">
            <span className="t">Net revenue retention</span>
            <span className="v">{nrrSeries[nrrSeries.length - 1].toFixed(0)}%</span>
          </div>
          <VegaLiteChart spec={nrrSpec} className="mini-chart" />
        </div>
        <div>
          <div className="mini-head">
            <span className="t">Logo churn</span>
            <span className="v">{churnSeries[churnSeries.length - 1].toFixed(1)}%</span>
          </div>
          <VegaLiteChart spec={churnSpec} className="mini-chart" />
        </div>
      </div>
    </div>
  );
}
