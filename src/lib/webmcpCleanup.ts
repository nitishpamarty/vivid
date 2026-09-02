// document.modelContext.registerTool's return value is a draft-spec detail
// some browser implementations get wrong — see webmcp.d.ts. Guard here once
// rather than in every registration module that maps over it.
export function callUnregisterFns(fns: unknown[]): void {
  fns.forEach((fn) => {
    if (typeof fn === 'function') fn();
  });
}
