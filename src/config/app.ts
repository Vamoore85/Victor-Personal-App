// Single source of truth for the app's identity.
// Rename the app by changing APP_NAME here (and "name" in package.json).
export const APP_NAME = "Maverick Personal";
export const APP_TAGLINE = "One place to run my whole life.";
export const OWNER_FIRST_NAME = "Victor";

// Shown on the public Privacy & Security page (/trust). Empty hides the Contact section.
export const TRUST_CONTACT_EMAIL = "vamoore85@gmail.com";

// Life areas shown on the home dashboard. Each will grow into its own module;
// an area with an href is live and links to its page.
// `short` is the label used where space is tight (phone tab bar); `group`
// sorts areas into sections on the home dashboard and in the navigation.
export type AreaGroup = "work" | "life";
type LifeArea = { slug: string; label: string; short: string; group: AreaGroup; blurb: string; href?: string };

export const AREA_GROUPS: readonly { id: AreaGroup; label: string }[] = [
  { id: "work", label: "Money & work" },
  { id: "life", label: "Life" },
];

export const LIFE_AREAS: readonly LifeArea[] = [
  { slug: "money", short: "Money", group: "work", label: "Financial Center", blurb: "Accounts, bills, cards, budgets and Maverick Vault", href: "/money" },
  { slug: "invest", short: "Invest", group: "work", label: "Invest", blurb: "Goals, plus the books and video clips that get you there", href: "/invest" },
  { slug: "ideas", short: "Ideas", group: "work", label: "Ideas", blurb: "A free-form place to dump ideas", href: "/ideas" },
  { slug: "research", short: "Research", group: "work", label: "Research Center", blurb: "Questions, notes and sources", href: "/research" },
  { slug: "events", short: "Events", group: "work", label: "Events & Speakers", blurb: "Special events and speakers worth following", href: "/events" },
  { slug: "legacy", short: "Legacy", group: "life", label: "Legacy", blurb: "Will, final wishes and instructions, locked", href: "/legacy" },
  { slug: "health", short: "Health", group: "life", label: "Health & Fitness", blurb: "Workouts, weight, sleep, and habits", href: "/health" },
  { slug: "style", short: "Style", group: "life", label: "Fashion & Clothes", blurb: "Wardrobe, outfits, and wish list", href: "/style" },
  { slug: "travel", short: "Travel", group: "life", label: "Travel & Vacation", blurb: "Trips, vacations, and places to go", href: "/travel" },
  { slug: "tasks", short: "Tasks", group: "work", label: "Tasks", blurb: "To-dos, projects, and priorities" },
  { slug: "calendar", short: "Calendar", group: "life", label: "Calendar", blurb: "Schedule, events, and reminders" },
  { slug: "people", short: "People", group: "life", label: "People", blurb: "Family, friends, and contacts" },
];
