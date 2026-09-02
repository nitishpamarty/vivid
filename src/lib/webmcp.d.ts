// WebMCP is a draft browser API (document.modelContext.registerTool) with no
// shipped TS lib yet — this is the minimal shape this app relies on.
interface ModelContextToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ModelContext {
  registerTool: (tool: ModelContextToolDescriptor) => (() => void) | void;
}

interface Document {
  modelContext?: ModelContext;
}
