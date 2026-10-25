import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { savePatternDraft } from "./pattern-workflow";

export async function savePatternSheet(input: {
  organizationId: string; userId: string; role: string; projectId: string;
  expectedUpdatedAt: string; idempotencyKey: string; origin?: unknown; originNote?: unknown;
  craftFamily?: unknown; sweater?: unknown; fabric?: unknown; references?: unknown;
  reason?: string; contextStamp?: string; choiceVisibility?: unknown;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.savePatternSheet)) throw new ExecutionError("当前角色不能改版单");
  return savePatternDraft({ organizationId: input.organizationId, userId: input.userId, role: input.role, factoryId: null }, input);
}
