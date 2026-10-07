// Single source of truth for the app's identity.
// Rename the app by changing APP_NAME here (and "name" in package.json).
export const APP_NAME = "Maverick Personal";
export const APP_TAGLINE = "One place to run my whole life.";

// Life areas shown on the home dashboard. Each will grow into its own module;
// an area with an href is live and links to its page.
type LifeArea = { slug: string; label: string; blurb: string; href?: string };

export const LIFE_AREAS: readonly LifeArea[] = [
  { slug: "money", label: "Financial Center", blurb: "Accounts, bills, cards, budgets and Maverick Vault", href: "/money" },
  { slug: "invest", label: "Invest", blurb: "Goals, plus the books and video clips that get you there", href: "/invest" },
  { slug: "ideas", label: "Ideas", blurb: "A free-form place to dump ideas", href: "/ideas" },
  { slug: "research", label: "Research Center", blurb: "Questions, notes and sources", href: "/research" },
  { slug: "events", label: "Events & Speakers", blurb: "Special events and speakers worth following", href: "/events" },
  { slug: "legacy", label: "Legacy", blurb: "Will, final wishes and instructions, locked", href: "/legacy" },
  { slug: "tasks", label: "Tasks", blurb: "To-dos, projects, and priorities" },
  { slug: "calendar", label: "Calendar", blurb: "Schedule, events, and reminders" },
  { slug: "health", label: "Health & Fitness", blurb: "Workouts, weight, sleep, and habits" },
  { slug: "style", label: "Fashion & Clothes", blurb: "Wardrobe, outfits, and wish list" },
  { slug: "travel", label: "Travel & Vacation", blurb: "Trips, vacations, and places to go" },
  { slug: "people", label: "People", blurb: "Family, friends, and contacts" },
];
