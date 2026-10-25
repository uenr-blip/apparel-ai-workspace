import type { PatternContent, PatternField } from "./pattern-workflow";

export type PatternCatalogItem = { id: string; label: string; imageSrc: string; description: string };
export type PatternCatalogResults = { items: PatternCatalogItem[]; limited: boolean };
export type PatternCatalogSource = {
  sourceId: string;
  materialId: string;
  label: string;
  fingerprint: string;
  content: PatternContent;
  fields: PatternField[];
  imageSrc: string;
  canAttachImage: boolean;
  choices: { id: string; label: string }[];
  materials: { id: string; label: string }[];
  notes: string[];
};
