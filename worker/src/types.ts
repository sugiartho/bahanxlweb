import type { WebuiUserRecord } from "./auth/users";
import type { Env } from "./env";
import type { StorageBackend } from "./storage/types";

export type AppVariables = {
  webuiUser: WebuiUserRecord | null;
  storage: StorageBackend;
};

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};