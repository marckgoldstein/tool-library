import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { FormValidation } from "@/components/form-validation";
import { JOIN_NOTICES } from "@/content/notices";
import { GENERAL_AREA_MAX, lookupInvite } from "@/server/invitations/service";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join", robots: { index: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** S3: an approved invitee joins from their single-use link. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupInvite(token);

  if (!invite.ok) {
    const expired = invite.reason === "expired";
    return (
      <>
        <h1>{expired ? "This invite link has expired" : "This invite link isn't valid"}</h1>
        <p>
          {expired
            ? "Invite links work for a week. The admin can send you a new one."
            : "It may have been used already, or part of it may be missing. Check that you opened the whole link from your email."}
        </p>
        <p>
          Already joined? <Link href="/sign-in">Sign in with your email</Link>. Otherwise, ask the person who suggested
          you to let the admin know, and the admin can send you a new link.
        </p>
      </>
    );
  }

  const session = await auth();
  const { memberCount, itemCount, invitation } = invite;
  return (
    <>
      <h1 id="join-heading">Welcome to {invite.communityName}</h1>
      <p className="lead">
        You&apos;re invited to a private group of friends and family who lend each other tools and gear.{" "}
        {memberCount > 0 && (
          <strong data-testid="group-size">
            {plural(memberCount, "member is", "members are")} sharing {plural(itemCount, "item", "items")}.
          </strong>
        )}
      </p>
      <p>No fees, no deposits, and owners approve every loan. Set up your profile below and we&apos;ll email your sign-in link to <strong>{invitation.inviteeEmail}</strong>.</p>
      {session?.user && (
        <p className="notice warn">
          You&apos;re signed in as someone else. Sign out first if this invite is for a different person.
        </p>
      )}
      <FormValidation />
      <JoinForm
        token={token}
        suggestedName={invitation.inviteeName}
        notices={JOIN_NOTICES}
        generalAreaMax={GENERAL_AREA_MAX}
      />
    </>
  );
}
