# UI Components

## Contained Portal Components

The contained components provide modified versions of shadcn components that ensure proper containment within the extension preview section.

### Why Use Contained Components?

When using standard shadcn components within the extension preview, portal-based content (drawers, dialogs, tooltips, popovers) may render outside the preview boundaries, breaking the visual containment. The contained components solve this by:

1. **Portal Targeting**: Rendering content within a specific portal container (`#extension-preview-portal`)
2. **Proper Positioning**: Ensuring content appears within the extension preview boundaries
3. **Overflow Handling**: Preventing content from breaking out of the preview container

### Available Contained Components

- **`contained-drawer.tsx`** - Drawer components (Drawer, DrawerContent, DrawerHeader, etc.)
- **`contained-dialog.tsx`** - Dialog components (Dialog, DialogContent, DialogHeader, etc.)
- **`contained-tooltip.tsx`** - Tooltip components (Tooltip, TooltipContent, TooltipTrigger, etc.)
- **`contained-popover.tsx`** - Popover components (Popover, PopoverContent, PopoverTrigger)

### Why Use Contained Drawers?

When using the standard shadcn drawer components within the extension preview, the drawer content may render outside the preview boundaries, breaking the visual containment. The contained drawer components solve this by:

1. **Portal Targeting**: Rendering drawer content within a specific portal container (`#extension-preview-portal`)
2. **Proper Positioning**: Ensuring drawers appear within the extension preview boundaries
3. **Overflow Handling**: Preventing drawers from breaking out of the preview container

### Usage

Replace standard shadcn portal component imports with contained component imports:

```tsx
// Instead of:
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/app/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";

// Use:
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/app/components/ui/contained-drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/contained-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/components/ui/contained-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/contained-popover";
```

### Portal Container

The extension preview automatically provides a portal container (`#extension-preview-portal`) that the contained drawers use for rendering. This ensures all drawer content stays within the preview boundaries.

### Components Available

#### Drawer Components
- `Drawer` - Main drawer container
- `DrawerContent` - Drawer content wrapper
- `DrawerHeader` - Drawer header section
- `DrawerTitle` - Drawer title
- `DrawerDescription` - Drawer description
- `DrawerFooter` - Drawer footer section
- `DrawerTrigger` - Drawer trigger button
- `DrawerClose` - Drawer close button
- `DrawerOverlay` - Drawer backdrop overlay

#### Dialog Components
- `Dialog` - Main dialog container
- `DialogContent` - Dialog content wrapper
- `DialogHeader` - Dialog header section
- `DialogTitle` - Dialog title
- `DialogDescription` - Dialog description
- `DialogFooter` - Dialog footer section
- `DialogTrigger` - Dialog trigger button
- `DialogClose` - Dialog close button
- `DialogOverlay` - Dialog backdrop overlay

#### Tooltip Components
- `Tooltip` - Main tooltip container
- `TooltipContent` - Tooltip content
- `TooltipTrigger` - Tooltip trigger element
- `TooltipProvider` - Tooltip context provider

#### Popover Components
- `Popover` - Main popover container
- `PopoverContent` - Popover content
- `PopoverTrigger` - Popover trigger element

### Examples

#### Drawer Example
```tsx
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle,
  DrawerTrigger 
} from "@/app/components/ui/contained-drawer";

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger>Open Drawer</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>My Drawer</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">
          Drawer content will be properly contained within the extension preview
        </div>
      </DrawerContent>
    </Drawer>
  );
}
```

#### Dialog Example
```tsx
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger 
} from "@/app/components/ui/contained-dialog";

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger>Open Dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>My Dialog</DialogTitle>
        </DialogHeader>
        <div className="p-4">
          Dialog content will be properly contained within the extension preview
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### Tooltip Example
```tsx
import { 
  Tooltip, 
  TooltipContent, 
  TooltipTrigger,
  TooltipProvider 
} from "@/app/components/ui/contained-tooltip";

function MyComponent() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>
          Tooltip content will be properly contained
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

### Migration

To migrate existing components:

1. Update import statements to use contained component imports
2. No other changes are required - the API is identical to standard shadcn components
3. All portal-based content will automatically be contained within the extension preview

#### Migration Checklist

- [ ] Replace `@/app/components/ui/drawer` with `@/app/components/ui/contained-drawer`
- [ ] Replace `@/app/components/ui/dialog` with `@/app/components/ui/contained-dialog`
- [ ] Replace `@/app/components/ui/tooltip` with `@/app/components/ui/contained-tooltip`
- [ ] Replace `@/app/components/ui/popover` with `@/app/components/ui/contained-popover`

### Technical Details

The contained components use React portals to render content within the `#extension-preview-portal` element, which is positioned absolutely within the extension preview container. This ensures that all portal-based content, including overlays, tooltips, and positioning, respects the preview boundaries.

#### Portal Container

The extension preview automatically provides a portal container (`#extension-preview-portal`) that all contained components use for rendering. This container is positioned absolutely within the preview boundaries and has a high z-index to ensure proper layering.

#### Component Behavior

- **Drawers**: Render from the bottom of the preview container
- **Dialogs**: Center within the preview container
- **Tooltips**: Position relative to their trigger elements within the preview
- **Popovers**: Position relative to their trigger elements within the preview

All components automatically fall back to standard behavior if the portal container is not available, ensuring backward compatibility.
