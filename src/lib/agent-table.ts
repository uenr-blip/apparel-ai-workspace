export const AGENT_RESULT_VERSION = "delivery-conclusion-v1";

/** Cells come from authorized business tools, never from parsing model prose or HTML. */
export type AgentTable = {
  title: string;
  columns: string[];
  rows: Array<{ cells: Array<string | number | null>; href?: string }>;
  notes?: string[];
  conclusion?: { tone: "attention" | "incomplete" | "neutral"; title: string; detail: string; nextStep: string };
  emptyMessage: string;
};
