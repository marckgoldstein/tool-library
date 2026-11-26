import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { Avatar } from "@/components/avatar";
import { DomainError } from "@/server/errors";
import { activeMembership, cleanTimezone } from "@/server/invitations/service";
import { getPublicProfile, type PublicProfile } from "@/server/profiles/service";

export const metadata: Metadata = { title: "Member" };
export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** S5: a member's profile, visible to their group. No email, no contact details, no inviter (D11, D13). */
export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;

  let profile: PublicProfile;
  try {
    profile = await getPublicProfile(user.id, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const viewer = await activeMembership(user.id);
  const joined = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: cleanTimezone(viewer?.timezone),
  }).format(profile.joinedAt);

  return (
    <>
      <div className="profile-head">
        <Avatar name={profile.name} photoKey={profile.photoKey} size={96} />
        <div>
          <h1>{profile.name}</h1>
          {profile.generalArea && <p className="muted" data-testid="profile-area">{profile.generalArea}</p>}
        </div>
      </div>
      <dl className="panel details" data-testid="profile-details">
        <dt>Member since</dt>
        <dd>
          <time dateTime={profile.joinedAt.toISOString()}>{joined}</time>
        </dd>
        <dt>Lent</dt>
        <dd data-testid="lent-count">{plural(profile.lentCount, "loan", "loans")}</dd>
        <dt>Borrowed</dt>
        <dd data-testid="borrowed-count">{plural(profile.borrowedCount, "loan", "loans")}</dd>
      </dl>
      <p className="hint">Counts include loans that have been returned and closed.</p>
      {profile.isSelf && (
        <p>
          This is how other members see you. <Link href="/profile">Edit your profile</Link>
        </p>
      )}
    </>
  );
}
