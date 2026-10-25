import { z } from "zod";

export const FieldSchema = z.object({
  value: z.union([z.string(), z.number()]).nullable(),
  sourceText: z.string().nullable(),
  start: z.number().int().nullable(),
  end: z.number().int().nullable(),
  kind: z.enum(["extracted", "inferred", "unknown", "conflict"]),
  inferenceNote: z.string().nullable(),
});

export const ColorQtySchema = z.object({
  colorName: z.string(),
  quantity: z.number().int().nonnegative(),
  sourceText: z.string().nullable(),
  start: z.number().int().nullable(),
  end: z.number().int().nullable(),
});

export const MaterialRefSchema = z.object({
  code: z.string(),
  sourceText: z.string().nullable(),
  start: z.number().int().nullable(),
  end: z.number().int().nullable(),
});

export const ExtractionSchema = z.object({
  intent: z.enum(["reorder", "new_style", "order_change", "material_dev", "unknown"]),
  customerName: FieldSchema,
  styleCode: FieldSchema,
  reuseExistingStyle: FieldSchema,
  externalCustomerPo: FieldSchema,
  totalQuantity: FieldSchema,
  colors: z.array(ColorQtySchema),
  materials: z.array(MaterialRefSchema).default([]),
  deliveryText: FieldSchema,
  deliveryDateInferred: FieldSchema,
  modifications: z.array(
    z.object({
      field: z.string(),
      requested: z.string(),
      sourceText: z.string().nullable(),
      start: z.number().int().nullable(),
      end: z.number().int().nullable(),
    }),
  ),
  sizeLines: z
    .array(
      z.object({
        colorName: z.string(),
        sizeCode: z.string(),
        quantity: z.number().int(),
        sourceText: z.string().nullable(),
        start: z.number().int().nullable(),
        end: z.number().int().nullable(),
        kind: z.enum(["extracted", "inferred", "unknown", "conflict"]),
        note: z.string().nullable(),
      }),
    )
    .default([]),
  unknowns: z.array(z.string()),
  jailbreakAttempt: z.boolean(),
  notes: z.array(z.string()),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type EvidenceField = z.infer<typeof FieldSchema>;

export function emptyField(kind: EvidenceField["kind"] = "unknown"): EvidenceField {
  return {
    value: null,
    sourceText: null,
    start: null,
    end: null,
    kind,
    inferenceNote: null,
  };
}
