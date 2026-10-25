import { DRAFT_ACTIONS, FACTORY_ACTIONS, FORMAL_ACTIONS, ROLES } from "@/lib/constants";

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function canApproveAction(role: string, actionType: string) {
  if (role === ROLES.factory) return FACTORY_ACTIONS.has(actionType as never);
  if (FORMAL_ACTIONS.has(actionType as never)) return role === ROLES.manager;
  if (DRAFT_ACTIONS.has(actionType as never)) {
    return role === ROLES.salesperson || role === ROLES.manager;
  }
  if (FACTORY_ACTIONS.has(actionType as never)) return role === ROLES.manager;
  return false;
}

export function canSeeFactory(role: string, userFactoryId: string | null, orderFactoryId: string | null) {
  if (role !== ROLES.factory) return true;
  return Boolean(userFactoryId && orderFactoryId && userFactoryId === orderFactoryId);
}
