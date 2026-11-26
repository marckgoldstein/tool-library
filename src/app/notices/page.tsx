import type { Metadata } from "next";
import { NOTICES, PRIVACY_NOTICE } from "@/content/notices";

export const metadata: Metadata = { title: "Notices" };

/** Required notices (PRD section 10). Draft wording; legal review pending (T12). */
export default function NoticesPage() {
  return (
    <>
      <h1>Notices</h1>
      {NOTICES.map((n) => (
        <section key={n.id} aria-labelledby={`notice-${n.id}`}>
          <h2 id={`notice-${n.id}`}>{n.title}</h2>
          <p>{n.body}</p>
        </section>
      ))}
      <section aria-labelledby="notice-data">
        <h2 id="notice-data">Your data</h2>
        <p>{PRIVACY_NOTICE}</p>
      </section>
    </>
  );
}
