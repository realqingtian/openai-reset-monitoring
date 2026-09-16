/* 即时悬停气泡：内容 portal 到 body，避免被滚动容器裁剪；代替延迟高、易被忽略的原生 title。
   配合 hooks/useTipPos 使用：const tip = useTipPos(); <span {...tip.bind}>…</span> + <TipBubble pos={tip.pos}>…</TipBubble> */

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TipPos } from "../hooks/useTipPos";

export function TipBubble({ pos, children }: { pos: TipPos | null; children: ReactNode }) {
  if (!pos) return null;
  return createPortal(
    <div className="heat-tip" style={{ left: Math.min(pos.x + 12, window.innerWidth - 240), top: Math.max(30, pos.y - 14) }}>
      {children}
    </div>,
    document.body,
  );
}
