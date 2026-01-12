CREATE TABLE "tenant_pricing_rules" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"min_job" numeric,
	"typical_low" numeric,
	"typical_high" numeric,
	"max_without_inspection" numeric,
	"service_fee" numeric,
	"tone" text DEFAULT 'value' NOT NULL,
	"risk_posture" text DEFAULT 'conservative' NOT NULL,
	"always_estimate_language" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"industry_key" text NOT NULL,
	"redirect_url" text,
	"thank_you_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
