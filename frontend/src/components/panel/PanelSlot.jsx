import { Component, Suspense, lazy } from "react";
import { Panel, PanelHeader, PanelBody, ErrorState } from "@/components/panel/Panel";

// The sidebar panels load on demand (they only ever open from a click), so
// the first paint doesn't pay for them; the lazy imports in Luna.jsx carry
// webpackPrefetch hints, so the browser still fetches them while idle and a
// click opens them instantly.
//
// After a deploy, a tab that's still open may ask for a chunk the server no
// longer has: reload once to pick up the new build instead of failing.
const RELOAD_KEY = "luna_chunk_reload";

export function lazyPanel(loader) {
  return lazy(() => loader().then(
    (mod) => {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch {}
      return mod;
    },
    (err) => {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1"; } catch {}
      if (!alreadyReloaded) {
        try { sessionStorage.setItem(RELOAD_KEY, "1"); } catch {}
        window.location.reload();
        return new Promise(() => {});
      }
      throw err;
    },
  ));
}

// Shown for the moment a panel's chunk is still on its way — the overlay
// appears at once, so the click never feels ignored.
function PanelLoading() {
  return <div className="fixed inset-0 z-[90] bg-[#05030b]/70 backdrop-blur-[6px]" aria-busy="true" />;
}

// A panel that fails to load or crashes shows an error card instead of
// unmounting the whole app.
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Panel failed to render:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { lang, onClose } = this.props;
    const t = (tr, en) => (lang === "tr" ? tr : en);
    return (
      <Panel onClose={onClose} size="sm" labelledBy="panel-error-title" testId="panel-error">
        <PanelHeader title={t("Bu bölüm açılamadı", "This section couldn't open")} titleId="panel-error-title"
          onClose={onClose} closeLabel={t("Kapat", "Close")} />
        <PanelBody>
          <ErrorState
            body={t("Bağlantını kontrol edip sayfayı yenile.", "Check your connection and reload the page.")}
            onRetry={() => window.location.reload()}
            retryLabel={t("Sayfayı yenile", "Reload page")}
          />
        </PanelBody>
      </Panel>
    );
  }
}

export default function PanelSlot({ lang, onClose, children }) {
  return (
    <PanelErrorBoundary lang={lang} onClose={onClose}>
      <Suspense fallback={<PanelLoading />}>{children}</Suspense>
    </PanelErrorBoundary>
  );
}
