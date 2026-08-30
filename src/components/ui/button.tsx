import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type MotionProps } from "framer-motion";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "native-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type MotionSafeButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps>;

export interface ButtonProps extends MotionSafeButtonProps, VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  asChild?: boolean;
  animated?: boolean;
  animationVariant?: "scale" | "glow" | "blur" | "tap";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, animated = true, animationVariant = "scale", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    const animationVariants = {
      scale: {
        whileHover: { scale: 1.05 },
        whileTap: { scale: 0.95 },
      },
      glow: {
        whileHover: {
          scale: 1.05,
          boxShadow: "0 0 20px rgba(59, 130, 246, 0.5)",
        },
        whileTap: { scale: 0.95 },
      },
      blur: {
        whileHover: { scale: 1.05, filter: "blur(0px)" },
        whileTap: { scale: 0.95, filter: "blur(0.5px)" },
      },
      tap: {
        whileTap: { scale: 0.92, rotateZ: -1 },
      },
    };

    const selectedAnimation = animationVariants[animationVariant] || animationVariants.scale;

    if (animated && Comp === "button") {
      return (
        <motion.button
          {...selectedAnimation}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 10,
          }}
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        />
      );
    }

    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
