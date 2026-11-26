# Product context: Tool Library (v0.1 pilot)

Written from PRD v1.0 for design work (Impeccable `init`, D34). Update it when the product changes.

## What it is
A free, invite-only web app where a friends-and-family group lends each other tools and gear. Members list what they own, find what others have, request dates, and the owner approves. Pickup, return, and the owner's confirmation are tracked; each step sends an email. No money, deposits, or fees. Trust comes from who gets in.

## Who uses it
- **Lender:** wants control and few surprises; approves every loan; shares contact details only by choice.
- **Borrower:** needs something once or twice a year; wants a fast yes and a clear way to ask questions.
- **Newcomer:** a friend of a member, approved by the admin; needs to feel welcome without a history.
- **Admin (Marck):** approves members, steps in on damage or loss.
Most people are both lender and borrower. Usage scene: at home, often on a phone, in the evening or on a weekend while planning a project.

## Surface mode
**Operate.** People come to complete a task (list, request, approve, hand off, return). Scanability, consistency, and familiar patterns outrank expression. Brand shows in precise details: calm green accent, warm paper background, clear status labels.

## Constraints
- Responsive web, mobile-first; WCAG 2.2 AA.
- Messages are canned only (a two-level tree by role and stage); no free text in v0.1.
- Contact details are sent only after a confirm step; the recipient sees: "Only contact this person if you are ready to give them your contact details."
- Every page links the required notices (lending risk, web service risk, meeting in person, built with AI tools).
- Show times in the viewer's timezone. Never show exact addresses; owners type a general area.
- Excluded items: weapons, vehicles, hazardous materials, medical devices, consumables.

## Tone
Plain and warm, like a neighbor's note. Name the action on every button. Errors say what happened and how to fix it. No exclamation-heavy marketing voice.
