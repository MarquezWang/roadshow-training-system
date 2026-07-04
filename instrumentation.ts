import { assertProductionAuthEnabled } from "@/lib/production-auth-guard";

export async function register() {
  assertProductionAuthEnabled();
}
