"use client";

import { cn } from "../../lib/utils";
import * as React from "react";

interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    return (
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={e => onCheckedChange?.(e.target.checked)}
          ref={ref}
          {...props}
        />
        <div
          className={cn(
            "h-6 w-11 rounded-full transition-colors duration-200 ease-in-out",
            checked ? "bg-green-600" : "bg-gray-200",
            className
          )}
        >
          <div
            className={cn(
              "h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out mt-0.5",
              checked ? "translate-x-5" : "translate-x-0"
            )}
          />
        </div>
      </label>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
