/**
 * Canned message catalog (D12, D24; PRD section 9).
 * Messages are stored by `templateKey`; wording lives here so it can change
 * without touching stored rows. Two levels: category -> message.
 */

export type ThreadRole = "asker" | "owner";

/** Where a thread is in its life, from the viewer's point of view. */
export type ThreadStage =
  | "before_pickup" // no loan, or a loan that is requested/approved
  | "approved" // a loan is approved, not yet picked up
  | "picked_up" // a loan is active (or overdue) or returned
  | "closed"; // the latest loan is closed, declined, or cancelled

export interface CannedMessage {
  key: string;
  text: string;
}

export interface CannedCategory {
  key: string;
  label: string;
  roles: ThreadRole[];
  stages: ThreadStage[];
  messages: CannedMessage[];
}

const ALL_STAGES: ThreadStage[] = ["before_pickup", "approved", "picked_up", "closed"];

export const CANNED_CATEGORIES: CannedCategory[] = [
  {
    key: "ask",
    label: "Ask about the item",
    roles: ["asker"],
    stages: ["before_pickup", "approved"],
    messages: [
      { key: "ask.available_dates", text: "Is this available for my dates?" },
      {
        key: "ask.complete",
        text: "Does it come with everything it needs (accessories, blades, batteries, charger)?",
      },
      { key: "ask.condition", text: "What condition is it in?" },
      { key: "ask.tips", text: "Any tips for using it?" },
    ],
  },
  {
    key: "answer",
    label: "Answer about the item",
    roles: ["owner"],
    stages: ["before_pickup", "approved"],
    messages: [
      { key: "answer.available", text: "Yes, it's available for those dates." },
      { key: "answer.unavailable", text: "Sorry, it's not available then." },
      { key: "answer.complete", text: "It comes with everything shown in the photos." },
      { key: "answer.partial", text: "Some parts aren't included; see the description." },
      {
        key: "answer.will_share_contact",
        text: "I'll send you my contact details so we can talk it through.",
      },
    ],
  },
  {
    key: "pickup",
    label: "Pickup",
    roles: ["asker", "owner"],
    stages: ["approved"],
    messages: [
      { key: "pickup.ready", text: "It's ready for pickup." },
      { key: "pickup.on_start", text: "Can I pick it up on the start date?" },
      { key: "pickup.evenings", text: "Evenings work best for me." },
      { key: "pickup.weekends", text: "Weekends work best for me." },
      { key: "pickup.running_late", text: "Running late; I'll send a new time shortly." },
    ],
  },
  {
    key: "return",
    label: "Return",
    roles: ["asker", "owner"],
    stages: ["picked_up"],
    messages: [
      { key: "return.on_way", text: "I'm on my way to return it." },
      { key: "return.extra_day", text: "I need an extra day; is that OK?" },
      { key: "return.done", text: "Returned it; please check it over." },
    ],
  },
  {
    key: "courtesy",
    label: "Courtesy",
    roles: ["asker", "owner"],
    stages: ALL_STAGES,
    messages: [
      { key: "courtesy.thanks", text: "Thanks!" },
      { key: "courtesy.all_good", text: "All good, thanks for taking care of it." },
    ],
  },
];

/** Reasons attached to a cancel or decline action, never sent alone. */
export const CANCEL_DECLINE_REASONS: CannedMessage[] = [
  { key: "reason.plans_changed", text: "Plans changed." },
  { key: "reason.no_show", text: "Didn't show up for pickup." },
  { key: "reason.dates", text: "Dates don't work." },
  { key: "reason.unavailable", text: "Item needs repair or is no longer available." },
];

/** Wording for a contact share (shown to both people). */
export const contactShareText = (value: string) => `Here's my contact info: ${value}`;

/** System note shown only to the recipient of a contact share. */
export const CONTACT_SHARE_RECIPIENT_NOTE =
  "Only contact this person if you are ready to give them your contact details.";

const MESSAGE_INDEX = new Map(
  CANNED_CATEGORIES.flatMap((c) => c.messages.map((m) => [m.key, { message: m, category: c }] as const)),
);
const REASON_INDEX = new Map(CANCEL_DECLINE_REASONS.map((r) => [r.key, r]));

export function cannedText(key: string): string | undefined {
  return MESSAGE_INDEX.get(key)?.message.text;
}

export function reasonText(key: string): string | undefined {
  return REASON_INDEX.get(key)?.text;
}

export function isReasonKey(key: string): boolean {
  return REASON_INDEX.has(key);
}

/** Categories a person may use, given their role and the thread's stage. */
export function categoriesFor(role: ThreadRole, stage: ThreadStage): CannedCategory[] {
  return CANNED_CATEGORIES.filter((c) => c.roles.includes(role) && c.stages.includes(stage));
}

/** Whether a template may be sent by this role at this stage (server-side check). */
export function isAllowedTemplate(key: string, role: ThreadRole, stage: ThreadStage): boolean {
  const entry = MESSAGE_INDEX.get(key);
  return !!entry && entry.category.roles.includes(role) && entry.category.stages.includes(stage);
}
