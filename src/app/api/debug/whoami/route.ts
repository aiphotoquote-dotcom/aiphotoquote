// src/app/api/debug/whoami/route.ts
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const a = await auth();
    const u = await currentUser();

    return NextResponse.json(
      {
        ok: true,
        userId: a.userId ?? null,
        email:
          u?.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
          u?.emailAddresses?.[0]?.emailAddress ??
          null,
      },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          pragma: "no-cache",
          expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "WHOAMI_FAILED",
        message: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}