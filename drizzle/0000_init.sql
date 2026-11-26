CREATE TYPE "public"."contact_type" AS ENUM('phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending_admin', 'approved', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('available', 'on_loan', 'paused', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."loan_outcome" AS ENUM('fine', 'damaged', 'not_returned');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('requested', 'approved', 'active', 'returned', 'closed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('zip', 'device');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('canned', 'contact_share');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'removed', 'deleted');--> statement-breakpoint
CREATE TABLE "auth_account" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "auth_account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	CONSTRAINT "category_parentId_name_unique" UNIQUE NULLS NOT DISTINCT("parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "community" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_share" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"user_contact_id" text,
	"contact_type" "contact_type" NOT NULL,
	"value_shared" text NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"asker_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"to_user_id" text,
	"to_email" text NOT NULL,
	"template" text NOT NULL,
	"related_id" text,
	"subject" text NOT NULL,
	"body" text,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"community_id" text NOT NULL,
	"suggested_by" text NOT NULL,
	"invitee_name" text NOT NULL,
	"invitee_email" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending_admin' NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "item_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"community_id" text NOT NULL,
	"category_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"condition" text NOT NULL,
	"handoff_notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "item_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_event" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"actor_id" text,
	"from_status" "loan_status",
	"to_status" "loan_status" NOT NULL,
	"reason_key" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"borrower_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "loan_status" DEFAULT 'requested' NOT NULL,
	"outcome" "loan_outcome",
	"reason_key" text,
	"picked_up_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"user_id" text NOT NULL,
	"community_id" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"invited_by" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "membership_user_id_community_id_pk" PRIMARY KEY("user_id","community_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"kind" "message_kind" NOT NULL,
	"template_key" text,
	"contact_share_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_contactShareId_unique" UNIQUE("contact_share_id")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "contact_type" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"email_verified" timestamp with time zone,
	"photo_key" text,
	"general_area" varchar(40),
	"timezone" text,
	"terms_accepted_at" timestamp with time zone,
	"role" "role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"postal_code" text,
	"approx_lat" numeric(6, 3),
	"approx_lng" numeric(6, 3),
	"location_source" "location_source",
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "auth_verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_share" ADD CONSTRAINT "contact_share_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_share" ADD CONSTRAINT "contact_share_sender_id_app_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_share" ADD CONSTRAINT "contact_share_user_contact_id_user_contact_id_fk" FOREIGN KEY ("user_contact_id") REFERENCES "public"."user_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_asker_id_app_user_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_to_user_id_app_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_suggested_by_app_user_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_photo" ADD CONSTRAINT "item_photo_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_borrower_id_app_user_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_invited_by_app_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_app_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_contact_share_id_contact_share_id_fk" FOREIGN KEY ("contact_share_id") REFERENCES "public"."contact_share"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact" ADD CONSTRAINT "user_contact_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_share_conversation_id_index" ON "contact_share" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_item_id_asker_id_index" ON "conversation" USING btree ("item_id","asker_id");--> statement-breakpoint
CREATE INDEX "email_log_to_email_created_at_index" ON "email_log" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "invitation_community_id_status_index" ON "invitation" USING btree ("community_id","status");--> statement-breakpoint
CREATE INDEX "invitation_invitee_email_index" ON "invitation" USING btree ("invitee_email");--> statement-breakpoint
CREATE INDEX "item_photo_item_id_index" ON "item_photo" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_community_id_status_index" ON "item" USING btree ("community_id","status");--> statement-breakpoint
CREATE INDEX "item_owner_id_index" ON "item" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "loan_event_loan_id_created_at_index" ON "loan_event" USING btree ("loan_id","created_at");--> statement-breakpoint
CREATE INDEX "loan_item_id_status_index" ON "loan" USING btree ("item_id","status");--> statement-breakpoint
CREATE INDEX "loan_borrower_id_status_index" ON "loan" USING btree ("borrower_id","status");--> statement-breakpoint
CREATE INDEX "loan_owner_id_status_index" ON "loan" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "message_conversation_id_created_at_index" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "user_contact_user_id_index" ON "user_contact" USING btree ("user_id");