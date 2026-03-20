export type ApiVariables = {
  requestId: string;
  tenantId: string;
  requestHost?: string;
  resolvedTenantSlug?: string;
  tenantResolverSource?:
    | "disabled"
    | "host"
    | "host_no_match"
    | "host_tenant_not_found"
    | "existing"
    | "header_id"
    | "header_slug"
    | "session";
  userId?: string;
  userRole?: "owner" | "admin";
};

export type ApiAppEnv = {
  Variables: ApiVariables;
};
