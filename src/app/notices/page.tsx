import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notices" };

/** Required notices (PRD section 10). Draft wording; legal review pending (T12). */
export default function NoticesPage() {
  return (
    <>
      <h1>Notices</h1>
      <h2>Lending risk</h2>
      <p>
        Members lend and borrow at their own risk. Inspect every item before use and follow its instructions. The
        operator isn&apos;t responsible for loss, damage, theft, or injury, or for anything agreed between members.
      </p>
      <h2>Web service risk</h2>
      <p>
        The site is provided as is, with no guarantee it will be available, error-free, or secure. Data may be lost.
        Don&apos;t share sensitive information in your profile or listings. The site never asks for passwords or
        payment; treat any message that does as a scam.
      </p>
      <h2>Meeting in person</h2>
      <p>Pickups and returns happen in person, arranged between members. Use your judgment about where and when to meet.</p>
      <h2>Built with AI tools</h2>
      <p>
        This site was designed and built with help from AI tools, including Anthropic&apos;s Claude. It may contain
        errors; report anything that looks wrong to the admin.
      </p>
      <h2>Your data</h2>
      <p>
        We keep your email, display name, optional photo, the general area you type, contact details you save, your
        listings, the messages you send, and your loan history. Contact details are shown only to a member you choose
        to send them to. We never collect your street address or device location. Deleting your account removes your
        personal data and keeps an anonymous record of past loans.
      </p>
    </>
  );
}
