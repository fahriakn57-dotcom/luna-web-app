// The legal pages live on the marketing site, same origin (lunai.tr/kvkk,
// ...). Always a plain <a>, NEVER react-router's <Link>: the app runs under
// basename "/app", so <Link to="/kvkk"> would resolve to /app/kvkk — which
// nginx serves as this SPA, not the legal page.
export const LEGAL_URLS = {
  terms: "/kullanim-sartlari",
  privacy: "/gizlilik-politikasi",
  kvkk: "/kvkk",
  consent: "/acik-riza-metni",
  preinfo: "/on-bilgilendirme-formu",
  salesContract: "/mesafeli-satis-sozlesmesi",
};

// `className` carries the color/hover styles (defaults to a plain white
// hover) so callers never stack two conflicting hover:text-* utilities.
export default function LegalLink({ href, className = "hover:text-white", children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`underline underline-offset-2 transition-colors ${className}`}>
      {children}
    </a>
  );
}
