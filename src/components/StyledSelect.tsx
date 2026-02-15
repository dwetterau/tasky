"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePopover } from "@/lib/usePopover";

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
}

export function StyledSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { refs, floatingStyles } = usePopover(isOpen);

  const selectedOption = options.find((o) => o.value === value);

  // Reset highlighted index to current value when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, options, value]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex, isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const reference = refs.domReference.current;
      const floating = refs.floating.current;
      if (
        reference &&
        !reference.contains(target) &&
        (!floating || !floating.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [refs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setHighlightedIndex((prev) =>
            prev < options.length - 1 ? prev + 1 : 0
          );
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : options.length - 1
          );
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen) {
          if (options[highlightedIndex]) {
            onChange(options[highlightedIndex].value);
            setIsOpen(false);
          }
        } else {
          setIsOpen(true);
        }
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(false);
        }
        break;
    }
  };

  const renderDropdown = () => {
    if (!isOpen) return null;

    itemRefs.current = [];

    const dropdownContent = (
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-50 bg-(--card-bg) border border-(--card-border) rounded-lg shadow-xl max-h-48 overflow-y-auto"
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onClick={() => {
              onChange(option.value);
              setIsOpen(false);
            }}
            onMouseEnter={() => setHighlightedIndex(index)}
            className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
              index === highlightedIndex
                ? "bg-(--accent)/10 text-accent"
                : "hover:bg-(--card-border)"
            }`}
          >
            {option.color && (
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: option.color }}
              />
            )}
            <span className="truncate">{option.label}</span>
            {option.value === value && (
              <svg
                className="w-4 h-4 ml-auto shrink-0 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>
        ))}
      </div>
    );

    return createPortal(dropdownContent, document.body);
  };

  return (
    <div ref={refs.setReference} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center justify-between h-[38px] px-3 bg-background border border-(--card-border) rounded-lg hover:border-accent focus-within:border-accent transition-colors text-sm focus:outline-none"
        type="button"
      >
        <span className="flex items-center gap-2 truncate">
          {selectedOption?.color && (
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: selectedOption.color }}
            />
          )}
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
        </span>
        <svg
          className={`w-4 h-4 shrink-0 text-(--muted) transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {renderDropdown()}
    </div>
  );
}
