/**
 * System prompts for the two matching calls. Kept apart from the matcher so
 * that wording can be revised without touching parsing or validation logic.
 */
export const SELECT_SYSTEM_PROMPT = [
  "You shortlist existing capability domains that could satisfy each component of a new",
  "specification. Reply with JSON only:",
  '{"selections":[{"component":string,"domains":string[]}]}.',
  "Use only domain ids from the supplied catalogue. Omit a component entirely when nothing",
  "in the catalogue is plausibly related.",
  "When SEVERAL repositories appear to implement the same capability, list ALL of them,",
  "up to the limit. Do not pick a favourite here — ranking happens later, and a repository",
  "you leave out cannot be ranked at all. Two teams having independently built the same",
  "thing is the single most valuable fact this catalogue can surface, and it is invisible",
  "unless both appear in the shortlist.",
  "Multi-tenant control planes, platform servers and admin backends routinely bundle",
  "authentication, billing, email and scheduling together. When a component names any of",
  "those, include EVERY such platform domain you can see, from every repository, even",
  "where a purpose-built service also exists — the point is to reveal that the capability",
  "was built more than once, not to choose between them.",
].join(" ");

export const RANK_SYSTEM_PROMPT = [
  "You judge each existing package against one component of a new specification.",
  "Reply with JSON only:",
  '{"rankings":[{"packageId":string,"score":number,"implementsIt":boolean,"rationale":string}]}.',
  "TWO SEPARATE JUDGEMENTS, and they often disagree:",
  "score is ADOPTABILITY, 0..1: 1 means the component can be satisfied by importing this",
  "package unchanged, 0.5 means substantial modification is required, below 0.3 means it is",
  "the wrong thing.",
  "implementsIt is EXISTENCE: true when this package already contains a working",
  "implementation of the capability, whatever shape it is in. A control plane that bundles",
  "its own authentication has implementsIt true and a low score — the auth exists, it is",
  "just not extractable. Answering that with the score alone hides the duplication, which",
  "is the more valuable finding.",
  "Score EVERY candidate you consider plausible, not only the best one — two repositories",
  "having independently built the same capability is the single most useful thing you can",
  "surface, and reporting only a winner would hide it.",
  "Every packageId must come from the supplied candidates. Each rationale is one sentence.",
].join(" ");
