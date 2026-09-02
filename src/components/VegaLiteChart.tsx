import { useEffect, useRef } from 'react';
import type { VisualizationSpec } from 'vega-embed';

interface Props {
  spec: VisualizationSpec;
  className?: string;
}

// Renders a Vega-Lite spec via vega-embed. The spec IS the chart state —
// this component just mounts it; a future WebMCP tool patches the spec
// object passed in, not this component.
// vega-embed (and the vega/vega-lite it pulls in) is the bulk of the app's
// JS — dynamic import splits it into its own chunk instead of blocking the
// main bundle.
export function VegaLiteChart({ spec, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let view: import('vega-embed').Result['view'] | undefined;
    import('vega-embed').then(({ default: embed }) => {
      if (cancelled) return undefined;
      return embed(el, spec, { actions: false, renderer: 'svg' });
    }).then((res) => {
      if (!res) return;
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
