import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { FormValidation } from "@/components/form-validation";
import { JOIN_NOTICES } from "@/content/notices";
import { GENERAL_AREA_MAX, lookupInvite } from "@/server/invitations/service";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join", robots: { index: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** S3: an approved invitee joins from their single-use link. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupInvite(token);

  if (!invite.ok) {
    return (
      <>
        <h1>This invite link has expired or was already used</h1>
        <p>
          Invite links work once and expire after a week. If you already joined,{" "}
          <Link href="/sign-in">sign in with your email</Link>. Otherwise, ask the person who suggested you to let the
          admin know, and the admin can send you a new link.
        </p>
      </>
    );
  }

  const session = await auth();
  return (
    <>
      <h1 id="join-heading">Join {invite.communityName}</h1>
      <p>
        You&apos;ve been invited to a private group that lends tools and gear to each other. No fees, no deposits;
        owners approve every loan. Set up your profile, accept the notices, and we&apos;ll email you a link to sign
        in. We don&apos;t collect your address.
      </p>
      {session?.user && (
        <p className="notice warn">
          You&apos;re signed in as someone else. Sign out first if this invite is for a different person.
        </p>
      )}
      <FormValidation />
      <JoinForm
        token={token}
        suggestedName={invite.invitation.inviteeName}
        notices={JOIN_NOTICES}
        generalAreaMax={GENERAL_AREA_MAX}
      />
    </>
  );
}
