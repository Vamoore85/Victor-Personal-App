// Single source of truth for the app's identity.
// Rename the app by changing APP_NAME here (and "name" in package.json).
export const APP_NAME = "Maverick Personal";
export const APP_TAGLINE = "One place to run my whole life.";

// Life areas shown on the home dashboard. Each will grow into its own module.
export const LIFE_AREAS = [
  { slug: "tasks", label: "Tasks", blurb: "To-dos, projects, and priorities" },
  { slug: "calendar", label: "Calendar", blurb: "Schedule, events, and reminders" },
  { slug: "money", label: "Money", blurb: "Budget, bills, and accounts" },
  { slug: "health", label: "Health", blurb: "Fitness, sleep, and habits" },
  { slug: "notes", label: "Notes", blurb: "Ideas, journal, and documents" },
  { slug: "people", label: "People", blurb: "Family, friends, and contacts" },
] as const;
