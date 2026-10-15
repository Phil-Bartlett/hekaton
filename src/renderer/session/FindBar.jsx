import { useEffect, useRef, useState } from "react";

// Search inside the terminal's scrollback. `search` is the handle the
// Terminal component exposes: findNext, findPrevious, clear.
export default function FindBar({ search, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => search.current?.clear();
  }, [search]);

  useEffect(() => {
    if (query) search.current?.findNext(query, { incremental: true });
    else search.current?.clear();
  }, [query, search]);

  function onKeyDown(event) {
    if (event.key === "Escape") onClose();
    else if (event.key === "Enter" && event.shiftKey) search.current?.findPrevious(query);
    else if (event.key === "Enter") search.current?.findNext(query);
    else return;
    event.preventDefault();
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-bar__input"
        placeholder="Find in terminal…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" onClick={() => search.current?.findPrevious(query)} aria-label="Previous match">
        ↑
      </button>
      <button type="button" onClick={() => search.current?.findNext(query)} aria-label="Next match">
        ↓
      </button>
      <button type="button" onClick={onClose} aria-label="Close search">
        ×
      </button>
    </div>
  );
}
