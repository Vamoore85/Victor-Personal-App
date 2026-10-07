// Single source of truth for the app's identity.
// Rename the app by changing APP_NAME here (and "name" in package.json).
export const APP_NAME = "Maverick Personal";
export const APP_TAGLINE = "One place to run my whole life.";

// Life areas shown on the home dashboard. Each will grow into its own module;
// an area with an href is live and links to its page.
type LifeArea = { slug: string; label: string; blurb: string; href?: string };

export const LIFE_AREAS: readonly LifeArea[] = [
  { slug: "tasks", label: "Tasks", blurb: "To-dos, projects, and priorities" },
  { slug: "calendar", label: "Calendar", blurb: "Schedule, events, and reminders" },
  { slug: "money", label: "Financial Center", blurb: "Accounts, spending, and budgets", href: "/money" },
  { slug: "health", label: "Health", blurb: "Fitness, sleep, and habits" },
  { slug: "notes", label: "Notes", blurb: "Ideas, journal, and documents" },
  { slug: "people", label: "People", blurb: "Family, friends, and contacts" },
];
