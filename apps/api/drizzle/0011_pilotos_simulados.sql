CREATE TABLE "bot_personas" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"skill" real NOT NULL,
	"aggression" real NOT NULL,
	"pit_risk" real NOT NULL,
	"hour_from" integer NOT NULL,
	"hour_to" integer NOT NULL,
	"join_rate" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_plans" (
	"race_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"join_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "bot_plans_race_id_user_id_pk" PRIMARY KEY("race_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "bot_personas" ADD CONSTRAINT "bot_personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_plans" ADD CONSTRAINT "bot_plans_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_plans" ADD CONSTRAINT "bot_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_plans_due_idx" ON "bot_plans" USING btree ("done_at","join_at");