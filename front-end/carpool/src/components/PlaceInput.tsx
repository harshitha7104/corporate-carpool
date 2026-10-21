import { useQuery } from "@tanstack/react-query";
import { MapPin, Star } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, qs } from "@/lib/api";
import { useMe } from "@/lib/session";
import type { Place } from "@/lib/types";
import { clsx } from "./ui";

type Result = { label: string; address: string; lat: number; lng: number; source: string };

const useDebounced = <T,>(value: T, ms = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

// Location autocomplete. Results come from the configured map provider; in
// development that is a list of Bengaluru localities (approximate centres).
export const PlaceInput = ({ label, value, onChange, placeholder, id, error }: { label: string; value: Place | null; onChange: (p: Place | null) => void; placeholder?: string; id?: string; error?: string }) => {
  const auto = useId();
  const fid = id || auto;
  const [text, setText] = useState(value?.label || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const q = useDebounced(text.trim());
  const { data: me } = useMe();

  useEffect(() => setText(value?.label || ""), [value?.label]);

  const results = useQuery({
    queryKey: ["places", q],
    queryFn: ({ signal }) => api.get<{ items: Result[]; live: boolean }>(`/places${qs({ q })}`, signal),
    enabled: open && q.length >= 2 && q !== value?.label,
    staleTime: 5 * 60_000,
  });
  const saved = useQuery({
    queryKey: ["saved-places"],
    queryFn: () => api.get<{ items: (Place & { id: string; address: string })[] }>("/users/me/places"),
    enabled: Boolean(me) && open,
    staleTime: 60_000,
  });

  const options: (Result & { saved?: boolean })[] = [
    ...(q.length < 2 ? (saved.data?.items || []).map((s) => ({ label: s.label, address: s.address, lat: s.lat, lng: s.lng, source: "saved", saved: true })) : []),
    ...(results.data?.items || []),
  ];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (r: Result) => {
    onChange({ label: r.label, lat: r.lat, lng: r.lng, address: r.address });
    setText(r.label);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <label htmlFor={fid} className="label">
        {label}
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={fid}
          className={clsx("input pl-9", error && "border-bad")}
          value={text}
          placeholder={placeholder || "Area, landmark or tech park"}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${fid}-list`}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (value) onChange(null);
          }}
          onKeyDown={(e) => {
            if (!open || !options.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      {open && options.length > 0 && (
        <ul id={`${fid}-list`} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lift">
          {options.map((o, i) => (
            <li
              key={`${o.label}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={clsx("flex cursor-pointer items-start gap-2.5 px-3 py-2", i === active && "bg-sunken")}
            >
              {o.saved ? <Star className="mt-0.5 h-4 w-4 text-signal" aria-hidden /> : <MapPin className="mt-0.5 h-4 w-4 text-muted" aria-hidden />}
              <span className="min-w-0">
                <span className="block font-medium">{o.label}</span>
                <span className="block truncate text-xs text-muted">{o.address}</span>
              </span>
            </li>
          ))}
          {results.data && !results.data.live && q.length >= 2 && (
            <li className="border-t border-line px-3 py-2 text-[11px] text-muted">Development map data: approximate locality centres, not exact addresses.</li>
          )}
        </ul>
      )}
      {open && q.length >= 2 && results.data && !options.length && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm text-muted shadow-lift">No places match "{q}". Try a nearby area or tech park name.</div>
      )}
    </div>
  );
};
