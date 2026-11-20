import { createAccessControl } from "better-auth/plugins/access";

// Permissions Better Auth checks for its own organisation endpoints (ADR-0003). Tenants themselves are created,
// renamed and disabled by global admins through CommuCal code, never through Better Auth (FR-1). Permissions on
// calendars and events are not Better Auth's concern; they are checked in CommuCal code with the member's role.
const statements = {
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const;

export const accessControl = createAccessControl(statements);

export const tenantRoles = {
  admin: accessControl.newRole({
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  contributor: accessControl.newRole({}),
};
