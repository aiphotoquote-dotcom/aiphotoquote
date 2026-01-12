import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import OpenAI from "openai";

const Req = z.object({
  openaiKey: z.string().min(10),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: { code: "UNAUTH", message: "Not signed in" } }, { status: 401 });

  const body = await req.json();
  const parsed = Req.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }

  try {
    const client = new OpenAI({ apiKey: parsed.data.openaiKey });

    // lightweight test call
    await client.models.list();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: { code: "OPENAI_KEY_INVALID", message: e?.message ?? "Failed to validate key" } },
      { status: 400 }
    );
  }
}
