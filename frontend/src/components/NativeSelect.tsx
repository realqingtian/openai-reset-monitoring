/* 保留原生表单值与 change 事件，展开菜单统一为站内玻璃浮层。 */
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { NAV_CHECK, NAV_CHEVRON_DOWN } from "./nav-icons";

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size" | "value" | "defaultValue"> & {
  value?: string | number;
  defaultValue?: string | number;
};
interface Choice { value: string; label: string; disabled: boolean; }
interface MenuPosition { left: number; top: number; width: number; maxHeight: number; }

function optionText(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === "string" || typeof child === "number" ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : "").join("");
}

function collectChoices(children: ReactNode, groupDisabled = false): Choice[] {
  const choices: Choice[] = [];
  Children.forEach(children, child => {
    if (!isValidElement<{ value?: string | number; label?: string; disabled?: boolean; hidden?: boolean; children?: ReactNode }>(child)) return;
    if (child.type === "option" && !child.props.hidden) {
      const label = child.props.label ?? optionText(child.props.children);
      choices.push({ value: String(child.props.value ?? label), label, disabled: groupDisabled || !!child.props.disabled });
    } else if (child.props.children) choices.push(...collectChoices(child.props.children, groupDisabled || !!child.props.disabled));
  });
  return choices;
}

export function NativeSelect(props: SelectProps) {
  const generatedId = useId();
  const id = props.id || generatedId;
  const listId = `${id}-listbox`;
  const choices = useMemo(() => collectChoices(props.children), [props.children]);
  const [fallbackValue, setFallbackValue] = useState(() => String(props.defaultValue ?? choices.find(choice => !choice.disabled)?.value ?? ""));
  const value = String(props.value ?? fallbackValue);
  const selectedIndex = choices.findIndex(choice => choice.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });

  function close(restoreFocus = false) {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }
  function show(index = selectedIndex) {
    if (props.disabled || !choices.some(choice => !choice.disabled)) return;
    setActiveIndex(index >= 0 && !choices[index]?.disabled ? index : choices.findIndex(choice => !choice.disabled));
    search.current = { text: "", at: 0 };
    setOpen(true);
  }
  function choose(index: number) {
    const choice = choices[index];
    if (!choice || choice.disabled) return;
    close(true);
    if (choice.value === value) return;
    setFallbackValue(choice.value);
    // 使用真实 select 派发 change，让现有受控状态、表单和筛选回调保持原有契约。
    if (nativeRef.current) {
      nativeRef.current.value = choice.value;
      nativeRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function move(direction: number, from = activeIndex) {
    for (let step = 1; step <= choices.length; step++) {
      const next = (from + direction * step + choices.length) % choices.length;
      if (!choices[next].disabled) { setActiveIndex(next); break; }
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") { close(); return; }
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.altKey && event.key === "ArrowUp" && open) { event.preventDefault(); close(true); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show(); else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.key === "Home" || event.key === "End") && open) {
      event.preventDefault();
      const index = event.key === "Home" ? choices.findIndex(choice => !choice.disabled) : choices.findLastIndex(choice => !choice.disabled);
      if (index >= 0) setActiveIndex(index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex); else show();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
      const now = Date.now();
      const letter = event.key.normalize("NFKC").toLocaleLowerCase();
      const term = now - search.current.at < 700 ? search.current.text + letter : letter;
      search.current = { text: term, at: now };
      const query = [...term].every(char => char === letter) ? letter : term;
      const from = open ? activeIndex : selectedIndex;
      const next = Array.from({ length: choices.length }, (_, offset) => (Math.max(from, -1) + offset + 1) % choices.length)
        .find(index => !choices[index].disabled && choices[index].label.normalize("NFKC").toLocaleLowerCase().startsWith(query));
      if (next != null) { event.preventDefault(); setActiveIndex(next); setOpen(true); }
    }
  }

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(triggerRef.current as EventTarget) && !path.includes(menuRef.current as EventTarget)) { setOpen(false); setPosition(null); }
    };
    const onBlur = () => { setOpen(false); setPosition(null); };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("touchstart", onOutside, { passive: true });
    window.addEventListener("blur", onBlur);
    return () => { document.removeEventListener("pointerdown", onOutside); document.removeEventListener("touchstart", onOutside); window.removeEventListener("blur", onBlur); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const update = () => {
      if (!trigger.isConnected || trigger.disabled || !trigger.getClientRects().length) { setOpen(false); setPosition(null); return; }
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const minX = (viewport?.offsetLeft || 0) + 8;
      const minY = (viewport?.offsetTop || 0) + 8;
      const right = minX + (viewport?.width || window.innerWidth) - 16;
      const bottom = minY + (viewport?.height || window.innerHeight) - 16;
      if (rect.bottom < minY || rect.top > bottom) { setOpen(false); setPosition(null); return; }
      const width = Math.min(Math.max(rect.width, 200), right - minX);
      const height = Math.min(menu.scrollHeight + 2, 320);
      const below = bottom - rect.bottom - 8;
      const above = rect.top - minY - 8;
      const upward = below < height && above > below;
      const maxHeight = Math.min(320, Math.max(44, upward ? above : below));
      const top = Math.max(minY, upward ? rect.top - Math.min(height, maxHeight) - 8 : rect.bottom + 8);
      const next = { left: Math.max(minX, Math.min(rect.right - width, right - width)), top, width, maxHeight };
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof MenuPosition] === next[key as keyof MenuPosition]) ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(trigger); observer.observe(menu);
    const visibilityObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) { setOpen(false); setPosition(null); }
    });
    visibilityObserver.observe(trigger);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer.disconnect(); visibilityObserver.disconnect();
      window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, props.disabled]);

  useLayoutEffect(() => {
    if (!open || !position) return;
    const menu = menuRef.current;
    const option = menu?.querySelector<HTMLElement>(`[data-choice-index="${activeIndex}"]`);
    if (!menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [open, activeIndex, position]);

  return <span className="select-control">
    <button ref={triggerRef} id={id} type="button" role="combobox" className={`select-trigger${props.className ? ` ${props.className}` : ""}`} style={props.style} disabled={props.disabled} title={props.title} tabIndex={props.tabIndex}
      aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]} aria-invalid={props["aria-invalid"]} aria-required={props.required}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined} aria-activedescendant={open && choices[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      onClick={() => { if (open) close(); else show(); }} onKeyDown={onKeyDown} onBlur={event => {
        // 触屏点按选项时焦点可能暂落 body，不能在 click 提交前卸载浮层。
        if (event.relatedTarget && !menuRef.current?.contains(event.relatedTarget as Node)) close();
      }}>
      <span className="select-value">{choices[selectedIndex]?.label || choices[0]?.label || ""}</span><span className="select-arrow" aria-hidden="true" dangerouslySetInnerHTML={{ __html: NAV_CHEVRON_DOWN }} />
    </button>
    <select {...props} id={`${id}-native`} ref={nativeRef} className="select-native" tabIndex={-1} aria-hidden="true" onInvalid={event => { event.preventDefault(); props.onInvalid?.(event); triggerRef.current?.focus(); show(); }} />
    {open && createPortal(<div ref={menuRef} id={listId} role="listbox" className="glass-select-menu" aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} style={position ? { ...position, visibility: "visible" } : { visibility: "hidden" }}>
      {choices.map((choice, index) => <div id={`${listId}-${index}`} key={`${choice.value}-${index}`} role="option" aria-selected={choice.value === value} aria-disabled={choice.disabled || undefined} data-choice-index={index}
        className={`glass-select-option${activeIndex === index ? " is-active" : ""}`} onPointerMove={event => { if (event.pointerType !== "touch" && !choice.disabled) setActiveIndex(index); }} onPointerDown={event => { if (event.pointerType === "mouse") event.preventDefault(); }} onClick={() => choose(index)}>
        <span className="glass-select-check" aria-hidden="true">{choice.value === value && <span dangerouslySetInnerHTML={{ __html: NAV_CHECK }} />}</span><span>{choice.label}</span>
      </div>)}
    </div>, document.body)}
  </span>;
}
