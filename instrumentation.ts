import { assertProductionAuthEnabled } from "@/lib/production-auth-guard.mjs";

export async function register() {
  assertProductionAuthEnabled();
}
