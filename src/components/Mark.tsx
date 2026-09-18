/** The app's mark: the same drawing as the favicon in public/icon.svg, inline so
 *  it takes the page's own font and its colours follow the theme. Keep the two
 *  in step — scripts/icons.mjs renders every icon file from the SVG. */
export default function Mark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" />
      <text x="32" y="33" textAnchor="middle" dominantBaseline="middle"
        fontSize="22" fontWeight="700" letterSpacing="-0.5">CKO</text>
    </svg>
  );
}
