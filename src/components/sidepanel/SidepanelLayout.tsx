import React from "react";
import { cn } from "../../lib/utils";

import { ScrollArea } from "../ui/scroll-area";

interface SidepanelLayoutProps {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function SidepanelLayout({
  children,
  title,
  actions,
  className,
  contentClassName,
}: SidepanelLayoutProps) {
  return (
    <div
      className={cn(
        "h-full w-full flex flex-col bg-background text-foreground overflow-hidden",
        className
      )}
    >
      {/* Header */}
      {/* {(title || actions) && (
        <div className="flex items-center justify-between p-4 border-b bg-muted/20 flex-shrink-0 h-[60px]">
          {title && <h2 className="text-lg font-semibold truncate">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )} */}

      {/* Content */}
      <ScrollArea className={cn("flex-1 [&>div]:!overflow-x-hidden", contentClassName)}>
        {children}
      </ScrollArea>
    </div>
  );
}
