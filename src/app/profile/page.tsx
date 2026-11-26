import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { Avatar } from "@/components/avatar";
import { FormValidation } from "@/components/form-validation";
import { getOwnContacts, getOwnProfile } from "@/server/profiles/service";
import { GENERAL_AREA_MAX } from "@/server/profiles/validation";
import { ContactsForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

/** Edit your own profile and your private contact details (S4). */
export default async function ProfileSettingsPage() {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const [me, contacts] = await Promise.all([getOwnProfile(user.id), getOwnContacts(user.id)]);

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
    </>
  );
}
