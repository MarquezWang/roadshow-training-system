import { NextResponse } from "next/server";
import { isAuthEnabled } from "@/lib/auth";
import { getCurrentAuthUser } from "@/lib/auth-server";

export async function GET() {
  if (!isAuthEnabled()) {
    return NextResponse.json({
      authEnabled: false,
      user: null,
    });
  }

  const user = await getCurrentAuthUser();

  return NextResponse.json({
    authEnabled: true,
    user,
  });
}
