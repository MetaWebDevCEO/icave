declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";

  export type IconProps = SVGProps<SVGSVGElement> & {
    size?: number | string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
  };

  export type LucideIcon = ComponentType<IconProps>;

  export const BarChart3: LucideIcon;
  export const Mail: LucideIcon;
  export const Briefcase: LucideIcon;
  export const User: LucideIcon;
  export const FolderKanban: LucideIcon;
  export const Clock: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const MessageCircle: LucideIcon;
}
