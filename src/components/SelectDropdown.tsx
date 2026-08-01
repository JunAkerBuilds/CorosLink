import { Check, ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export interface SelectDropdownProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  menuClassName?: string;
  renderIcon?: (value: T) => ReactNode;
  disabled?: boolean;
  portal?: boolean;
  title?: string;
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  transform?: string;
}

type PortalTheme = CSSProperties & Record<`--${string}`, string>;

const PORTAL_THEME_VARIABLES = [
  "--surface",
  "--glass-border",
  "--glass-bg-hover",
  "--text-primary",
  "--text-secondary",
  "--accent",
  "--accent-soft",
  "--radius-sm"
] as const;

const MENU_CLOSE_DURATION_MS = 180;

export function SelectDropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  menuClassName,
  renderIcon,
  disabled = false,
  portal = false,
  title
}: SelectDropdownProps<T>) {
  const dropdownId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const typeaheadRef = useRef({ query: "", updatedAt: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [highlightedValue, setHighlightedValue] = useState<T>(value);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [portalTheme, setPortalTheme] = useState<PortalTheme>({});
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? "Select";
  const selectedIcon = renderIcon?.(value);
  const isMenuMounted = isOpen || isClosing;
  const labelId = `${dropdownId}-label`;
  const valueId = `${dropdownId}-value`;
  const menuId = `${dropdownId}-menu`;

  const openMenu = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsClosing(false);
    setIsOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setIsClosing(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setIsClosing(false);
      closeTimerRef.current = null;
    }, MENU_CLOSE_DURATION_MS);
  }, []);

  const updateMenuPosition = useCallback(() => {
    if (!portal || !triggerRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(triggerRef.current);
    const viewportMargin = 8;
    const menuGap = 6;
    const menuWidth = Math.min(
      Math.max(trigger.width, 220),
      window.innerWidth - viewportMargin * 2
    );
    const preferredHeight = Math.min(menuRef.current?.scrollHeight ?? 280, 280);
    const roomBelow = window.innerHeight - trigger.bottom - viewportMargin;
    const roomAbove = trigger.top - viewportMargin;
    const opensUp = roomBelow < Math.min(preferredHeight, 180) && roomAbove > roomBelow;
    const availableRoom = Math.max(96, (opensUp ? roomAbove : roomBelow) - menuGap);

    setMenuPosition({
      left: Math.max(viewportMargin, Math.min(trigger.left, window.innerWidth - menuWidth - viewportMargin)),
      top: opensUp ? trigger.top - menuGap : trigger.bottom + menuGap,
      width: menuWidth,
      maxHeight: Math.min(preferredHeight, availableRoom),
      transform: opensUp ? "translateY(-100%)" : undefined
    });
    setPortalTheme(Object.fromEntries(
      PORTAL_THEME_VARIABLES.map((name) => [name, computedStyle.getPropertyValue(name)])
    ) as PortalTheme);
  }, [portal]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHighlightedValue(value);

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    }

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Tab") {
        closeMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [closeMenu, isOpen, value]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!isMenuMounted || !portal) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateMenuPosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [isMenuMounted, portal, updateMenuPosition]);

  function moveHighlight(direction: 1 | -1) {
    if (options.length === 0) {
      return;
    }

    const currentIndex = options.findIndex(
      (option) => option.value === highlightedValue
    );
    const fallbackIndex = options.findIndex((option) => option.value === value);
    const startIndex =
      currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0);
    const nextIndex = (startIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];

    if (nextOption) {
      setHighlightedValue(nextOption.value);
    }
  }

  function selectOption(nextValue: T) {
    onChange(nextValue);
    setHighlightedValue(nextValue);
    closeMenu();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        openMenu();
        setHighlightedValue(value);
        return;
      }

      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (isOpen && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const option = event.key === "Home" ? options[0] : options[options.length - 1];
      if (option) setHighlightedValue(option.value);
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isOpen) {
      event.preventDefault();
      selectOption(highlightedValue);
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = typeaheadRef.current;
      const query = `${now - previous.updatedAt > 700 ? "" : previous.query}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current = { query, updatedAt: now };
      const match = options.find((option) => option.label.toLocaleLowerCase().startsWith(query));
      if (match) {
        openMenu();
        setHighlightedValue(match.value);
      }
    }
  }

  const menu = isMenuMounted ? (
    <div
      className={[
        "app-select-menu",
        portal ? "is-portaled" : "",
        isOpen && (!portal || menuPosition) ? "is-opening" : "",
        isClosing ? "is-closing" : "",
        menuClassName
      ]
        .filter(Boolean)
        .join(" ")}
      id={menuId}
      ref={menuRef}
      role="listbox"
      aria-label={label}
      aria-hidden={isClosing || undefined}
      data-side={menuPosition?.transform ? "top" : "bottom"}
      style={portal ? ({
        ...portalTheme,
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        width: menuPosition?.width ?? 0,
        maxHeight: menuPosition?.maxHeight ?? 280,
        transform: menuPosition?.transform,
        visibility: menuPosition ? "visible" : "hidden"
      } satisfies CSSProperties) : undefined}
    >
      <div className="app-select-menu-list">
        {options.map((option, index) => {
          const isSelected = option.value === value;
          const isActive = option.value === highlightedValue;
          const optionIcon = renderIcon?.(option.value);

          return (
            <button
              type="button"
              className={[
                "app-select-option",
                isSelected ? "is-selected" : "",
                isActive ? "is-active" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              data-value={option.value}
              id={`${dropdownId}-option-${String(option.value)}`}
              key={option.value}
              role="option"
              aria-selected={isSelected}
              style={{
                "--app-select-delay": `${40 + index * 18}ms`
              } as CSSProperties}
              onClick={() => selectOption(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedValue(option.value)}
            >
              <span className="app-select-option-content">
                {optionIcon ? (
                  <span className="app-select-leading-icon" aria-hidden="true">
                    {optionIcon}
                  </span>
                ) : null}
                <span className="app-select-option-label">{option.label}</span>
              </span>
              {isSelected ? (
                <Check
                  className="app-select-option-check"
                  size={15}
                  strokeWidth={2.6}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={["app-select", className].filter(Boolean).join(" ")}
      data-value={value}
      ref={rootRef}
    >
      <span className="sr-only" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        className="app-select-trigger"
        ref={triggerRef}
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={isOpen && options.length ? `${dropdownId}-option-${String(highlightedValue)}` : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (!disabled) {
            if (isOpen) {
              closeMenu();
            } else {
              openMenu();
            }
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="app-select-value" id={valueId}>
          {selectedIcon ? (
            <span className="app-select-leading-icon" aria-hidden="true">
              {selectedIcon}
            </span>
          ) : null}
          <span className="app-select-value-label">{selectedLabel}</span>
        </span>
        <ChevronDown
          className={isOpen ? "app-select-icon is-open" : "app-select-icon"}
          size={17}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {portal && menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : menu}
    </div>
  );
}
