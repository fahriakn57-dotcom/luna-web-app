import "@/App.css";
import { useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Luna from "@/pages/Luna";
import AccountGate from "@/pages/AccountGate";
import VerifyEmail from "@/pages/VerifyEmail";
import ResetPassword from "@/pages/ResetPassword";
import { Toaster } from "@/components/ui/sonner";
import { isAuthed } from "@/lib/api";

function Home() {
  const [authed, setAuthed] = useState(() => isAuthed());
  const lang = localStorage.getItem("luna_lang") || "tr";

  if (!authed) {
    return <AccountGate lang={lang} onDone={() => setAuthed(true)} />;
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
