import type { MetadataRoute } from "next";

import { BG } from "@/lib/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Garmin Health",
    short_name: "Garmin",
    description: "Your Garmin readiness, recovery, training and sleep at a glance.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BG,
    theme_color: BG,
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
