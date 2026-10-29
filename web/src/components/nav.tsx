import {
  IconBarbell,
  IconCalendarEvent,
  IconMoon,
  IconSunHigh,
  IconTrendingUp,
  type Icon,
} from "@tabler/icons-react";

/** Question-led navigation: each page answers one question. */
export interface NavItem {
  href: "/" | "/load" | "/fitness" | "/sleep" | "/plan";
  label: string;
  icon: Icon;
  question: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: IconSunHigh, question: "Train hard today?" },
  { href: "/load", label: "Load", icon: IconBarbell, question: "Am I overtraining?" },
  { href: "/fitness", label: "Fitness", icon: IconTrendingUp, question: "Am I getting fitter?" },
  { href: "/sleep", label: "Sleep", icon: IconMoon, question: "Recovering well?" },
  { href: "/plan", label: "Plan", icon: IconCalendarEvent, question: "What's my next session?" },
];

export function navItem(href: NavItem["href"]): NavItem {
  return NAV.find((n) => n.href === href)!;
}
