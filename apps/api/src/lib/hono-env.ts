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
    | "header_id_internal"
    | "header_id_browser"
    | "header_slug_internal"
    | "header_slug_browser"
    | "session";
  userId?: string;
  userRole?: "owner" | "admin";
  userEmailVerified?: boolean;
};

export type ApiAppEnv = {
  Variables: ApiVariables;
};
