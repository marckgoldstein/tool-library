/**
 * Required notices (PRD section 10, T8). Draft wording until the legal review (T12).
 * One source for the join screen, the notices page and anywhere else they appear.
 */
export interface Notice {
  id: "lending-risk" | "web-service-risk" | "meeting-in-person" | "built-with-ai";
  title: string;
  /** One plain line, shown collapsed on the join page; the full body is one tap away. */
  summary: string;
  body: string;
}

export const NOTICES: Notice[] = [
  {
    id: "lending-risk",
    title: "Lending risk",
    summary: "You lend and borrow at your own risk.",
    body: "Members lend and borrow at their own risk. Inspect every item before use and follow its instructions. The operator isn't responsible for loss, damage, theft, or injury, or for anything agreed between members.",
  },
  {
    id: "web-service-risk",
    title: "Web service risk",
    summary: "The site comes with no guarantees, and never asks for passwords or payment.",
    body: "The site is provided as is, with no guarantee it will be available, error-free, or secure. Data may be lost. Don't share sensitive information in your profile or listings. The site never asks for passwords or payment; treat any message that does as a scam.",
  },
  {
    id: "meeting-in-person",
    title: "Meeting in person",
    summary: "You arrange pickups and returns in person.",
    body: "Pickups and returns happen in person, arranged between members. Use your judgment about where and when to meet.",
  },
  {
    id: "built-with-ai",
    title: "Built with AI tools",
    summary: "Made with help from AI tools, so tell the admin if something looks wrong.",
    body: "This site was designed and built with help from AI tools, including Anthropic's Claude. It may contain errors; report anything that looks wrong to the admin.",
  },
];

/** The notices shown on the join screen (PRD section 10, "Where it appears"). */
export const JOIN_NOTICES = NOTICES.filter((n) => n.id !== "meeting-in-person");

export const PRIVACY_NOTICE =
  "We keep your email, display name, optional photo, the general area you type, contact details you save, your listings, the messages you send, and your loan history. Contact details are shown only to a member you choose to send them to. We never collect your street address or device location. Deleting your account removes your personal data and keeps an anonymous record of past loans.";
