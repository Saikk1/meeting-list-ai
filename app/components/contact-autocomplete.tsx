"use client";

import { Clock3, Search, UserRound } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  listContacts,
  type ContactRecord,
} from "../lib/contacts";

export function ContactAutocomplete({
  value,
  className = "",
  ariaLabel,
  placeholder,
  onChange,
  onSelect,
}: {
  value: string;
  className?: string;
  ariaLabel: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSelect: (contact: ContactRecord) => void;
}) {
  const listId = `contact-results-${useId().replace(/:/g, "")}`;
  const requestSequence = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({
    left: 12,
    top: 0,
    width: 360,
  });

  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void listContacts({
        query: value.trim(),
        limit: 8,
        signal: controller.signal,
      })
        .then((payload) => {
          if (requestSequence.current !== sequence) return;
          setResults(payload.contacts);
          setActiveIndex(0);
        })
        .catch((requestError) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(
            requestError instanceof Error
              ? requestError.message
              : "通讯录读取失败",
          );
        })
        .finally(() => {
          if (requestSequence.current === sequence) setLoading(false);
        });
    }, value.trim() ? 180 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focused, value]);

  const open = focused && (loading || Boolean(error) || results.length > 0);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(
        420,
        Math.max(320, Math.min(rect.width, window.innerWidth - 24)),
      );
      const left = Math.max(
        12,
        Math.min(rect.left, window.innerWidth - width - 12),
      );
      setMenuPosition({
        left,
        top: rect.bottom + 5,
        width: Math.min(width, window.innerWidth - 24),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  function selectContact(contact: ContactRecord) {
    onSelect(contact);
    setFocused(false);
    setResults([]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex(
        (current) => (current - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      selectContact(results[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      setFocused(false);
    }
  }

  return (
    <div
      className="contact-autocomplete"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={
          open && results[activeIndex]
            ? `${listId}-${results[activeIndex].id}`
            : undefined
        }
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
      />

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="contact-autocomplete__menu"
              id={listId}
              role="listbox"
              style={menuPosition}
            >
          <div className="contact-autocomplete__hint">
            {value.trim() ? <Search size={13} /> : <Clock3 size={13} />}
            {value.trim() ? "通讯录匹配结果" : "最近使用的联系人"}
          </div>
          {loading ? (
            <div className="contact-autocomplete__state">正在搜索通讯录…</div>
          ) : error ? (
            <div className="contact-autocomplete__state error">{error}</div>
          ) : (
            results.map((contact, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                id={`${listId}-${contact.id}`}
                key={contact.id}
                className={index === activeIndex ? "is-active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectContact(contact)}
              >
                <span className="contact-autocomplete__avatar">
                  <UserRound size={15} />
                </span>
                <span className="contact-autocomplete__copy">
                  <strong>{contact.name}</strong>
                  <small>
                    {contact.unit}
                    {contact.department ? ` · ${contact.department}` : ""}
                    {contact.title ? ` · ${contact.title}` : ""}
                  </small>
                </span>
                {contact.meetingCount > 0 ? (
                  <span className="contact-autocomplete__count">
                    {contact.meetingCount} 次
                  </span>
                ) : null}
              </button>
            ))
          )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
