CREATE TABLE "checkpoints" (
	"pk" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_pk" uuid NOT NULL,
	"checkpoint_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"session_id" text,
	"event" text NOT NULL,
	"task" text,
	"branch" text,
	"head_sha" text,
	"digest" text,
	"changed_files" text[] DEFAULT '{}' NOT NULL,
	"diff_lines" integer DEFAULT 0 NOT NULL,
	"outcome_label" text,
	"outcome_category" text,
	"outcome_confidence" real,
	"outcome_statement" text,
	"classified_by" text,
	"review_model_id" text,
	"cli_version" text,
	"schema_version" text,
	"data" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_findings" (
	"pk" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkpoint_pk" uuid NOT NULL,
	"repo_pk" uuid NOT NULL,
	"checkpoint_id" text NOT NULL,
	"idx" integer NOT NULL,
	"concern" text NOT NULL,
	"kind" text DEFAULT 'intent' NOT NULL,
	"tier" integer,
	"confidence" real,
	"target" text,
	"delivery" text NOT NULL,
	"label" text,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"pk" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_pk" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"pk" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"repo_pk" uuid,
	"pref_id" text NOT NULL,
	"scope" text NOT NULL,
	"statement" text NOT NULL,
	"category" text,
	"status" text NOT NULL,
	"evidence" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_configs" (
	"repo_pk" uuid PRIMARY KEY NOT NULL,
	"effective" jsonb NOT NULL,
	"effective_hash" text DEFAULT '' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_repo_pk_repos_id_fk" FOREIGN KEY ("repo_pk") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_findings" ADD CONSTRAINT "intent_findings_checkpoint_pk_checkpoints_pk_fk" FOREIGN KEY ("checkpoint_pk") REFERENCES "public"."checkpoints"("pk") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_findings" ADD CONSTRAINT "intent_findings_repo_pk_repos_id_fk" FOREIGN KEY ("repo_pk") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_repo_pk_repos_id_fk" FOREIGN KEY ("repo_pk") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_repo_pk_repos_id_fk" FOREIGN KEY ("repo_pk") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_configs" ADD CONSTRAINT "repo_configs_repo_pk_repos_id_fk" FOREIGN KEY ("repo_pk") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_repo_ckpt" ON "checkpoints" USING btree ("repo_pk","checkpoint_id");--> statement-breakpoint
CREATE INDEX "checkpoints_repo_time" ON "checkpoints" USING btree ("repo_pk","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "checkpoints_repo_outcome" ON "checkpoints" USING btree ("repo_pk","outcome_label");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_findings_ckpt_idx" ON "intent_findings" USING btree ("checkpoint_pk","idx");--> statement-breakpoint
CREATE INDEX "intent_findings_repo_sig" ON "intent_findings" USING btree ("repo_pk","signature");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_repo_seq" ON "ledger_entries" USING btree ("repo_pk","seq");--> statement-breakpoint
CREATE INDEX "ledger_repo_model" ON "ledger_entries" USING btree ("repo_pk","model");--> statement-breakpoint
CREATE UNIQUE INDEX "preferences_repo_pref" ON "preferences" USING btree ("repo_pk","pref_id") WHERE scope = 'repo';--> statement-breakpoint
CREATE UNIQUE INDEX "preferences_user_pref" ON "preferences" USING btree ("user_id","pref_id") WHERE scope = 'user';--> statement-breakpoint
CREATE INDEX "preferences_repo_status" ON "preferences" USING btree ("repo_pk","status");