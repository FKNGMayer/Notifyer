import { useId } from "react";

/** The app mark: a note card with a notification dot, drawn for small UI sizes. */
export default function AppGlyph({ size = 18 }: { size?: number }) {
  const mask = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        <circle cx="18.6" cy="5.4" r="4.7" fill="black" />
        <rect x="6.6" y="9.6" width="9" height="1.7" rx="0.85" fill="black" />
        <rect x="6.6" y="13.2" width="10.6" height="1.7" rx="0.85" fill="black" />
        <rect x="6.6" y="16.8" width="6" height="1.7" rx="0.85" fill="black" />
      </mask>
      <rect x="2.6" y="3.4" width="18.2" height="18.2" rx="5.2" fill="currentColor" mask={`url(#${mask})`} />
      <circle cx="18.6" cy="5.4" r="3.1" fill="var(--orange)" />
    </svg>
  );
}
