import { ChevronDown, Play, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
export function StartSessionButton({ disabled, timerDisabled, onTimer, onStopwatch }: { disabled: boolean; timerDisabled: boolean; onTimer: () => void; onStopwatch: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null), item = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div ref={root} className="start-button start-split" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button className="start-main" disabled={disabled || timerDisabled} onClick={onTimer}><Play size={20} fill="currentColor"/>{t("Start")}</button>
    <button ref={toggle} className="start-chevron" aria-label={t("More start options")} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}><ChevronDown size={18}/></button>
    {open && <div className="start-mode-menu" role="menu"><button ref={item} role="menuitem" onClick={() => { setOpen(false); onStopwatch(); }}><Timer size={18}/>{t("Start stopwatch")}</button></div>}
  </div>;
}
