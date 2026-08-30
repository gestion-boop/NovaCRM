/** Branded icons for property links – used in PropertyCard & PropertyDetail */
import { forwardRef } from "react";
import { Video, RotateCw } from "lucide-react";

export const VirtualTourIcon = forwardRef<HTMLDivElement, { className?: string }>(
  ({ className = "h-5 w-5" }, ref) => (
    <div ref={ref} className={`${className} flex items-center justify-center text-[#F9C977]`}>
      <Video className="w-full h-full" />
    </div>
  )
);
VirtualTourIcon.displayName = "VirtualTourIcon";

export const Giraffe360Icon = forwardRef<HTMLDivElement, { className?: string; withBg?: boolean }>(
  ({ className = "h-5 w-5" }, ref) => (
    <div ref={ref} className={`${className} rounded-full flex items-center justify-center bg-[#F7BC5F]/15 text-[#F9C977]`}>
      <RotateCw className="w-3/4 h-3/4" />
    </div>
  )
);
Giraffe360Icon.displayName = "Giraffe360Icon";

export function WebsiteIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <img
      src="/Logo Immosphera.png"
      alt="Immosphera"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
