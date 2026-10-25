import { z } from "zod";
export const FollowSuggestion = z.object({
  kind: z.enum(["sales_sample", "bulk"]),
  title: z.string().trim().min(1).max(80),
  seasonCode: z.string().trim().max(40),
  factoryName: z.string().trim().max(80),
}).strict();
export type FollowSuggestion = z.infer<typeof FollowSuggestion>;
