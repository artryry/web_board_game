import {
  Circle,
  Crown,
  Droplet,
  Flame,
  Leaf,
  Moon,
  Mountain,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";

// The catalog's `origin_icons` keys are Lucide icon names. Each one is imported on its own, so
// the bundle holds only these.
const ICONS: Readonly<Record<string, LucideIcon>> = {
  circle: Circle,
  leaf: Leaf,
  flame: Flame,
  waves: Waves,
  mountain: Mountain,
  sun: Sun,
  moon: Moon,
  snowflake: Snowflake,
  skull: Skull,
  zap: Zap,
  shield: Shield,
  crown: Crown,
  star: Star,
  droplet: Droplet,
  wind: Wind,
  sparkles: Sparkles,
};

interface OriginIconProps {
  icon: string;
  className?: string;
}

/** An origin's icon, decorative: the origin's name always comes with it. */
export function OriginIcon({ icon, className = "size-4 shrink-0" }: OriginIconProps) {
  // A key from a newer backend that this build doesn't know shows as a circle.
  return createElement(ICONS[icon] ?? Circle, { "aria-hidden": true, className });
}
