/* 静态图标共用 24px 网格与线宽，小尺寸下保持清晰；不接收第三方内容。 */
function icon(paths: string, size = 18, className = "") {
  return `<svg class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export const SVG_OK = icon('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>', 36);
export const SVG_ALERT = icon('<path d="M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M10 21h4"/>', 36);
export const SVG_LINK = icon('<path d="M8 5H5v14h14v-3M13 5h6v6M19 5 10 14"/>', 14);
export const SVG_RSS = icon('<circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/>', 14);
export const SVG_BOLT = icon('<path d="m13 3-9 11h7l-1 7 10-11h-7l1-7Z"/>', 14);
export const SVG_LANG = icon('<path d="M3 5h12M9 3v2M5 5c1 5 5 8 9 10M13 5c-1 5-5 8-9 10M13 21l4-10 4 10M14.5 18h5"/>', 16);
export const SVG_LOCK = icon('<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>');
export const SVG_USER = icon('<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>');
export const SVG_CHEV = icon('<path d="m7 10 5 5 5-5"/>', 14, "chev");
export const SVG_CHEV_LEFT = icon('<path d="m14 6-6 6 6 6"/>');
export const SVG_CHEV_RIGHT = icon('<path d="m10 6 6 6-6 6"/>');
export const SVG_GLOBE = icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9"/>');
export const SVG_CHECK = icon('<path d="m5 12 4 4L19 6"/>', 16, "ck");
export const SVG_CLOCK = icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 14);
export const SVG_SUN = icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>');
export const SVG_MOON = icon('<path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/>');
export const SVG_MONITOR = icon('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>');
export const SVG_REFRESH = icon('<path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5"/>');
export const SVG_SPINNER = icon('<path d="M21 12a9 9 0 1 1-9-9"/>', 18, "ico-spin");
export const SVG_CLOSE = icon('<path d="m6 6 12 12M6 18 18 6"/>', 16);
export const SVG_OPTIONS = icon('<path d="M4 7h7M15 7h5M4 17h3M11 17h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>');
