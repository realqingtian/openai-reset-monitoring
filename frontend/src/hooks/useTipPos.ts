/* 悬停气泡的鼠标位置跟踪：记录指针 client 坐标供 TipBubble 定位（离开元素时清空）。 */

import { useState, type FocusEvent, type MouseEvent } from "react";

export interface TipPos {
  x: number;
  y: number;
}

export function useTipPos() {
  const [pos, setPos] = useState<TipPos | null>(null);
  const bind = {
    onMouseEnter: (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY }),
    onMouseMove: (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPos(null),
    onFocus: (e: FocusEvent<HTMLElement>) => { const rect = e.currentTarget.getBoundingClientRect(); setPos({ x: rect.left, y: rect.bottom }); },
    onBlur: () => setPos(null),
  };
  return { pos, bind };
}
