import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { FormValidation } from "@/components/form-validation";
import { activeMembership, cleanTimezone, listForSuggester } from "@/server/invitations/service";
import { SuggestForm } from "./suggest-form";

export const metadata: Metadata = { title: "Suggest someone" };
export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  pending_admin: "Waiting for the admin",
  approved: "Invite sent",
  accepted: "Joined",
  declined: "Not approved",
  expired: "Invite expired",
} as const;

/** S1: a member suggests someone; the admin decides (D10). */
export default async function InvitePage() {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const member = await activeMembership(user.id);
  if (!member) redirect("/");
  const mine = await listForSuggester(user.id);
  const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: cleanTimezone(member.timezone) });

  return (
    <>
      <h1 id="suggest-heading">Suggest someone to join</h1>
      <p>
        The group is invite-only. Suggest someone you know and trust; the admin reviews every suggestion, and if they
        approve, your friend gets an invite link by email. Your name isn&apos;t shown to other members as the person
        who suggested them.
      </p>
      <FormValidation />
      <SuggestForm />

      <h2>Your suggestions</h2>
      {mine.length === 0 ? (
        <p>You haven&apos;t suggested anyone yet.</p>
      ) : (
        <ul className="rows" data-testid="my-suggestions">
          {mine.map((s) => (
            <li key={s.id}>
              <span>{s.inviteeName}</span>
              <span className="status" data-status={s.status}>
                {STATUS_LABEL[s.status]}
              </span>
              <time className="muted" dateTime={s.createdAt.toISOString()}>
                {dateFmt.format(s.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
