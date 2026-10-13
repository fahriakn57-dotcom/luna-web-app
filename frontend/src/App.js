import "@/App.css";
import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Luna from "@/pages/Luna";
import AccountGate from "@/pages/AccountGate";
import VerifyEmail from "@/pages/VerifyEmail";
import ResetPassword from "@/pages/ResetPassword";
import { Toaster } from "@/components/ui/sonner";
import { isAuthed } from "@/lib/api";
import { initialUiLang } from "@/lib/i18n";

function Home() {
  const [authed, setAuthed] = useState(() => isAuthed());
  // The saved interface language, else the browser's: a first visit from
  // abroad sees the sign-up screen in English (lib/i18n.js).
  const [lang, setLang] = useState(() => initialUiLang());
  useEffect(() => {
    localStorage.setItem("luna_lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  if (!authed) {
    return <AccountGate lang={lang} setLang={setLang} onDone={() => setAuthed(true)} />;
  }
  return <Luna />;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter basename="/app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" />
    </div>
  );
}

export default App;
