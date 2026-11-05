CREATE TABLE "crazy_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"invite_code" text NOT NULL,
	"race_count" integer NOT NULL,
	"laps" integer NOT NULL,
	"interval_minutes" integer NOT NULL,
	"chaos" boolean DEFAULT true NOT NULL,
	"bot_fill" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crazy_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crazy_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "crazy_group_id" uuid;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "crazy_round" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crazy_groups" ADD CONSTRAINT "crazy_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crazy_members" ADD CONSTRAINT "crazy_members_group_id_crazy_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."crazy_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crazy_members" ADD CONSTRAINT "crazy_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crazy_groups_invite_uq" ON "crazy_groups" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "crazy_groups_owner_idx" ON "crazy_groups" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "crazy_members_user_idx" ON "crazy_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_crazy_group_id_crazy_groups_id_fk" FOREIGN KEY ("crazy_group_id") REFERENCES "public"."crazy_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "races_crazy_idx" ON "races" USING btree ("crazy_group_id");