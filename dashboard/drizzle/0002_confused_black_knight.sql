CREATE TABLE "proof_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
