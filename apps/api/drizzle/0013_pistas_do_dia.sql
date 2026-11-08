CREATE TABLE "track_plans" (
	"slot_at" timestamp with time zone PRIMARY KEY NOT NULL,
	"track_version_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_plans" ADD CONSTRAINT "track_plans_track_version_id_track_versions_id_fk" FOREIGN KEY ("track_version_id") REFERENCES "public"."track_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_plans" ADD CONSTRAINT "track_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;