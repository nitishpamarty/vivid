import { useEffect, useRef } from 'react';
import embed, { type VisualizationSpec } from 'vega-embed';

interface Props {
  spec: VisualizationSpec;
  className?: string;
}

// Renders a Vega-Lite spec via vega-embed. The spec IS the chart state —
// this component just mounts it; a future WebMCP tool patches the spec
// object passed in, not this component.
export function VegaLiteChart({ spec, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    let view: import('vega-embed').Result['view'] | undefined;
    embed(ref.current, spec, { actions: false, renderer: 'svg' }).then((res) => {
      if (cancelled) res.view.finalize();
      else view = res.view;
    });
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);

  return <div ref={ref} className={className} />;
}
