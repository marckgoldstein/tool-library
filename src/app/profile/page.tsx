import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { Avatar } from "@/components/avatar";
import { ConfirmAction } from "@/components/confirm-action";
import { FormValidation } from "@/components/form-validation";
import { deletionBlockers } from "@/server/account/service";
import { deleteAccountAction } from "./actions";
import { getOwnContacts, getOwnProfile } from "@/server/profiles/service";
import { GENERAL_AREA_MAX } from "@/server/profiles/validation";
import { ContactsForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

/** Edit your own profile and your private contact details (S4). */
export default async function ProfileSettingsPage() {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const [me, contacts, blockers] = await Promise.all([getOwnProfile(user.id), getOwnContacts(user.id), deletionBlockers(user.id)]);

  return (
    <>
      <div className="profile-head">
        <Avatar name={me.name ?? "Member"} photoKey={me.photoKey} size={64} />
        <div>
          <h1 id="profile-heading">Your profile</h1>
          <p className="muted">
            <Link href={`/members/${me.id}`}>See your profile as other members do</Link>
          </p>
        </div>
      </div>
      <FormValidation />
      <ProfileForm
        name={me.name ?? ""}
        generalArea={me.generalArea ?? ""}
        hasPhoto={!!me.photoKey}
        generalAreaMax={GENERAL_AREA_MAX}
      />

      <h2 id="contacts-heading">Contact details</h2>
      <p>
        Save a phone number, an email, or both, so you can send one to a member when you arrange a pickup. They stay
        private: nobody sees them until you choose to send one to a specific person.
      </p>
      <ContactsForm phone={contacts.phone ?? ""} email={contacts.email ?? ""} />

      <h2 id="delete-heading">Delete your account</h2>
      {blockers.openLoans > 0 ? (
        <p data-testid="delete-blocked">
          You have {blockers.openLoans === 1 ? "a loan" : `${blockers.openLoans} loans`} in progress. Finish or cancel{" "}
          {blockers.openLoans === 1 ? "it" : "them"} on <Link href="/loans">Loans</Link>, then you can delete your account.
        </p>
      ) : blockers.lastAdmin ? (
        <p data-testid="delete-blocked">
          You&apos;re the group&apos;s only admin. Make someone else an admin on <Link href="/admin/members">Members</Link>{" "}
          first.
        </p>
      ) : (
        <>
          <p>
            This removes your name, email, photo, general area and contact details. Your items are delisted and any
            pending requests are closed. Past loans stay in the record as &ldquo;Former member&rdquo;.
          </p>
          <ConfirmAction
            label="Delete my account…"
            title="Delete your account?"
            confirmLabel="Delete my account"
            pendingLabel="Deleting…"
            cancelLabel="Keep my account"
            action={deleteAccountAction}
            fields={{}}
            danger
          >
            <p>This can&apos;t be undone. To come back later, you&apos;d need a new invite.</p>
            <div className="field check">
              <input id="confirmDelete" name="confirmDelete" type="checkbox" value="yes" required />
              <label htmlFor="confirmDelete">I understand my account and details will be removed</label>
            </div>
          </ConfirmAction>
        </>
      )}
    </>
  );
}
