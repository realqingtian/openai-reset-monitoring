/* 账号头像：优先数据源提取的 X 头像（safeUrl 只放行 http/https），
   缺失或加载失败时降级为按 handle 取色的字母头像，深浅主题共用固定渐变。 */

import { useState } from "react";
import { safeUrl } from "../utils/format";

const GRADS = ["fb-a", "fb-b", "fb-c", "fb-d"];

function hashHandle(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return h;
}

export function AccountAvatar({
  handle,
  name,
  avatar,
  size = 38,
}: {
  handle: string;
  name?: string | null;
  avatar?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const url = safeUrl(avatar || "");
  if (!url || broken) {
    const initial = (name || handle || "?").trim().charAt(0).toUpperCase();
    return (
      <span className={`tavatar-fb ${GRADS[hashHandle(handle) % GRADS.length]}`} style={style} aria-hidden>
        {initial}
      </span>
    );
  }
  return (
    <img
      className="tavatar"
      style={style}
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
