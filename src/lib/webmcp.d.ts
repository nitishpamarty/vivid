// WebMCP is a draft browser API (document.modelContext.registerTool) with no
// shipped TS lib yet — this is the minimal shape this app relies on.
interface ModelContextToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ModelContext {
  // Draft spec says unregister callback or void, but at least one deployed
  // implementation returns a non-function truthy value instead — callers
  // must not assume the return value is callable.
  registerTool: (tool: ModelContextToolDescriptor) => unknown;
}

interface Document {
  modelContext?: ModelContext;
}
