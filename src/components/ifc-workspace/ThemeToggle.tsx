import { buttonVariants } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { Check, Monitor, Moon, Sun } from "lucide-react";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  { value: "system", label: "System" },
];

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Farbschema wählen"
        title="Farbschema"
        className={cn(buttonVariants({ size: "icon-sm", variant: "ghost" }))}
      >
        {resolvedTheme === "dark" ? (
          <Moon aria-hidden className="size-4" />
        ) : (
          <Sun aria-hidden className="size-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="justify-between"
            onClick={() => setTheme(option.value)}
          >
            <span className="flex items-center gap-2">
              {option.value === "light" ? (
                <Sun aria-hidden className="size-3.5" />
              ) : option.value === "dark" ? (
                <Moon aria-hidden className="size-3.5" />
              ) : (
                <Monitor aria-hidden className="size-3.5" />
              )}
              {option.label}
            </span>
            {theme === option.value ? (
              <Check aria-hidden className="size-3.5 text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
