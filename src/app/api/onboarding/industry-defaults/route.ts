// src/app/api/onboarding/industry-defaults/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
  return null;
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

function normalizeIndustryKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/* --------------------- schema --------------------- */

const GetSchema = z.object({
  tenantId: z.string().min(1),
  industryKey: z.string().min(1),
});

/* --------------------- defaults --------------------- */

type Defaults = {
  industryKey: string;
  subIndustries: Array<{ key: string; label: string; blurb?: string | null }>;
  commonServices: string[];
  commonPhotoRequests: string[];
  defaultCustomerQuestions: string[];
};

function makeGeneric(industryKey: string): Defaults {
  return {
    industryKey,
    subIndustries: [],
    commonServices: [
      "Consultation / estimate",
      "Repair / replacement",
      "New install / build",
      "Labor + materials",
    ],
    commonPhotoRequests: [
      "Wide shot of the full job area",
      "Close-ups of damage / wear / detail areas",
      "Measurement reference (tape measure in frame)",
      "Any labels/plates/brand/model identifiers (if applicable)",
    ],
    defaultCustomerQuestions: [
      "What are you looking to accomplish (repair vs upgrade vs new build)?",
      "What’s the approximate size or quantity?",
      "Any deadlines or timing constraints?",
      "Any material or finish preferences?",
      "Anything we should avoid or match to existing work?",
    ],
  };
}

const PRESETS: Record<string, Defaults> = {
  upholstery: {
    industryKey: "upholstery",
    subIndustries: [
      { key: "auto_upholstery", label: "Automotive upholstery", blurb: "Seats, door panels, headliners, interiors." },
      { key: "marine_upholstery", label: "Marine upholstery", blurb: "Boat cushions, sun pads, vinyl, snaps, foam." },
      { key: "furniture_upholstery", label: "Furniture upholstery", blurb: "Sofas, chairs, cushions, reupholstery." },
    ],
    commonServices: [
      "Seat / cushion repair",
      "Foam replacement or reshaping",
      "Full recover (vinyl/leather/fabric)",
      "Custom stitching (diamond, french seams, etc.)",
      "Hardware (snaps, hinges, buttons, trim)",
    ],
    commonPhotoRequests: [
      "Wide shot of the full item (front + side)",
      "Close-ups of damage/tears and seams",
      "Underside / mounting points (if marine/auto)",
      "A photo with tape measure across width/length",
    ],
    defaultCustomerQuestions: [
      "Is this for auto, marine, or furniture?",
      "Repair or full recover?",
      "Material preference (vinyl/leather/fabric) and color?",
      "Any foam changes (firmer/softer/thicker)?",
      "Do you have a deadline (event, trip, season)?",
    ],
  },

  landscaping_hardscaping: {
    industryKey: "landscaping_hardscaping",
    subIndustries: [
      { key: "landscape_design", label: "Landscape design" },
      { key: "hardscaping", label: "Hardscaping (patios/walls/walkways)" },
      { key: "drainage_grading", label: "Drainage & grading" },
      { key: "lighting", label: "Outdoor lighting" },
    ],
    commonServices: [
      "Design & install",
      "Patios / pavers / retaining walls",
      "Drainage solutions",
      "Planting / mulching / cleanup",
      "Outdoor living features (fire pit, seating, kitchens)",
    ],
    commonPhotoRequests: [
      "Wide shots of the full yard (from corners)",
      "Close-ups of problem areas (drainage, slope, damage)",
      "Photos of access points (gates, driveways)",
      "Any inspiration photos of desired style",
    ],
    defaultCustomerQuestions: [
      "What area(s) are we improving (front/back/side yard)?",
      "What’s the goal (function vs curb appeal vs drainage)?",
      "Any must-have features (patio, wall, lighting, etc.)?",
      "Do you have inspiration photos or a preferred style?",
      "Any budget range or phasing plan?",
    ],
  },

  paving_contractor: {
    industryKey: "paving_contractor",
    subIndustries: [
      { key: "driveways", label: "Driveways" },
      { key: "parking_lots", label: "Parking lots" },
      { key: "sealcoating", label: "Sealcoating" },
      { key: "repairs", label: "Patching & repairs" },
    ],
    commonServices: [
      "New asphalt / overlay",
      "Sealcoating",
      "Crack fill / patching",
      "Re-striping (commercial)",
      "Grading & base prep",
    ],
    commonPhotoRequests: [
      "Wide shot of the full paved area",
      "Close-ups of cracking/potholes/edges",
      "Photo showing tie-ins (garage apron, street)",
      "Approximate dimensions or a photo with tape/measuring wheel",
    ],
    defaultCustomerQuestions: [
      "Residential driveway or commercial lot?",
      "New surface, overlay, or repairs only?",
      "Any drainage issues or standing water?",
      "Approximate dimensions (or can we measure on site)?",
      "Any time constraints (weather, business hours)?",
    ],
  },

  automotive_repair: {
    industryKey: "automotive_repair",
    subIndustries: [
      { key: "collision", label: "Collision" },
      { key: "paint_body", label: "Paint & body" },
      { key: "mechanical", label: "Mechanical repair" },
      { key: "glass", label: "Glass" },
    ],
    commonServices: [
      "Damage assessment",
      "Panel repair/replacement",
      "Paint & refinish",
      "Mechanical repair (varies by shop)",
      "Insurance estimate support (if offered)",
    ],
    commonPhotoRequests: [
      "Wide shots of the vehicle (all angles)",
      "Close-ups of damaged panels and gaps",
      "VIN plate / make/model (if comfortable sharing)",
      "Any warning lights or dashboard messages (if relevant)",
    ],
    defaultCustomerQuestions: [
      "Is the vehicle drivable?",
      "Which panels/areas are damaged?",
      "Any prior damage in the same area?",
      "Do you want OEM, aftermarket, or repair-if-possible?",
      "Insurance claim involved (yes/no)?",
    ],
  },
};

/* --------------------- handler --------------------- */

export async function GET(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const u = new URL(req.url);
    const parsed = GetSchema.safeParse({
      tenantId: u.searchParams.get("tenantId"),
      industryKey: u.searchParams.get("industryKey"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "tenantId and industryKey are required." },
        { status: 400 }
      );
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const key = normalizeIndustryKey(parsed.data.industryKey);
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid industryKey." },
        { status: 400 }
      );
    }

    const defaults = PRESETS[key] ?? makeGeneric(key);

    return NextResponse.json({ ok: true, tenantId, defaults }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}