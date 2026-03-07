export type ApiVariables = {
  requestId: string;
  tenantId: string;
  userId?: string;
  userRole?: "owner" | "admin";
};

export type ApiAppEnv = {
  Variables: ApiVariables;
};
