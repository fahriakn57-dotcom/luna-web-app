import { useEffect, useState } from "react";
import {
  Bell, BellOff, Brain, CalendarPlus, Download, FileText, Globe, ImageOff, Loader2, Maximize2, SlidersHorizontal,
  StickyNote, Target, Trash2, Trophy,
} from "lucide-react";
import { fetchMessageFile, fetchReminderIcs, setReplyLang } from "../lib/api";
import { applyActions, formatDue, normalizeActions } from "../lib/agentActions";

// What comes with one of Luna's replies besides its text (components/
// ChatMessage.jsx):
// - SourceChips: the web pages a searched reply used (`sources`, from the
//   turn's answer or a stored message's meta.web_sources), as small links.
// - AttachmentList: a picture or a file made in chat (`attachments`, see
//   lib/api.js normalizeAttachments) — pictures inline (tap to open), files
//   as download cards. Bytes that came inline are used as they are; others
//   are fetched from GET /api/messages/{id}/file with the device's auth.
// - ActionCards: what Luna did in the account that turn (`actions`, backend
//   services/agent_tools.py; lib/agentActions.js) — a reminder card with
//   "Takvime ekle" (Google Calendar) and ".ics indir", a note, a goal, a
//   memory, a reply preference.

const UI = {
  tr: {
    sources: "Kaynaklar",
    open: "Görseli büyüt",
    imageFailed: "Görsel yüklenemedi",
    retry: "Tekrar dene",
    download: "İndir",
    downloadFailed: "İndirilemedi, tekrar dene.",
    reminder_created: "Hatırlatıcı kuruldu",
    reminder_cancelled: "Hatırlatıcı silindi",
    note_created: "Not kaydedildi",
    goal_added: "Hedef eklendi",
    goal_completed: "Hedef tamamlandı",
    memory_saved: "Hafızaya eklendi",
    memory_forgotten: "Hafızadan silindi",
    preference_set: "Tercih güncellendi",
    addToCalendar: "Takvime ekle",
    downloadIcs: ".ics indir",
    daily: "her gün",
    weekly: "her hafta",
    monthly: "her ay",
  },
  en: {
    sources: "Sources",
    open: "Open image",
    imageFailed: "Couldn't load the image",
    retry: "Try again",
    download: "Download",
    downloadFailed: "Couldn't download it — try again.",
    reminder_created: "Reminder set",
    reminder_cancelled: "Reminder deleted",
    note_created: "Note saved",
    goal_added: "Goal added",
    goal_completed: "Goal completed",
    memory_saved: "Saved to memory",
    memory_forgotten: "Removed from memory",
    preference_set: "Preference updated",
    addToCalendar: "Add to calendar",
    downloadIcs: "Download .ics",
    daily: "every day",
    weekly: "every week",
    monthly: "every month",
  },
};
// Turkish only for Turkish; every other language reads English (lib/i18n.js uiLang).
const uiFor = (lang) => UI[lang === "tr" ? "tr" : "en"];

export function SourceChips({ sources, lang = "tr" }) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const ui = uiFor(lang);
  return (
    <div className="mt-2.5 border-t border-white/5 pt-2" data-testid="chat-sources">
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-purple-300/70">{ui.sources}</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" title={s.title}
            data-testid="chat-source-chip"
            className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-purple-400/25 bg-purple-400/10 px-2.5 py-1 text-[11px] text-purple-100 transition-colors hover:bg-purple-400/20 hover:text-white">
            <Globe size={11} className="shrink-0 text-purple-300" />
            <span className="truncate">{s.domain || s.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function formatSize(bytes, lang = "tr") {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const dot = (s) => (lang === "en" ? s : s.replace(".", ","));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${dot((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

// The picture's address: its inline bytes, or a blob URL of the fetched
// ones (let go when the bubble goes). retry() asks again after a failure.
function useAttachmentUrl(att) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(() => (att.dataUrl ? { url: att.dataUrl, status: "ready" } : { url: "", status: "loading" }));
  useEffect(() => {
    if (att.dataUrl) {
      setState({ url: att.dataUrl, status: "ready" });
      return undefined;
    }
    let cancelled = false;
    let objectUrl = "";
    const ctl = typeof window.AbortController === "function" ? new window.AbortController() : null;
    setState({ url: "", status: "loading" });
    fetchMessageFile(att.messageId, ctl ? { signal: ctl.signal } : {})
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ url: "", status: "error" });
      });
    return () => {
      cancelled = true;
      ctl?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.dataUrl, att.messageId, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

function AttachmentImage({ att, ui, onOpen }) {
  const { url, status, retry } = useAttachmentUrl(att);
  if (status === "loading") {
    return <div className="h-48 w-full max-w-xs animate-pulse rounded-xl bg-white/5" data-testid="chat-attachment-loading" />;
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-purple-400/20 bg-black/20 px-3 py-2.5 text-xs text-purple-200/80"
        data-testid="chat-attachment-error">
        <ImageOff size={15} className="shrink-0" />
        <span className="flex-1">{ui.imageFailed}</span>
        <button type="button" onClick={retry} className="shrink-0 rounded-full border border-purple-400/30 px-2.5 py-1 hover:bg-purple-400/15">
          {ui.retry}
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => onOpen?.({ src: url, name: att.name })} aria-label={ui.open}
      data-testid="chat-attachment-image" className="group relative block w-full">
      <img src={url} alt={att.name} className="max-h-72 max-w-full rounded-xl object-cover transition-opacity group-hover:opacity-80" />
      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition-colors group-hover:bg-black/25 group-hover:opacity-100">
        <Maximize2 size={22} className="text-white drop-shadow" />
      </span>
    </button>
  );
}

// Hands a fetched file to the browser's download (a blob URL let go a bit
// later, once the download has surely started).
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function AttachmentFile({ att, ui, lang }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const size = formatSize(att.sizeBytes, lang);
  const cardClass = "flex w-full items-center gap-2.5 rounded-xl border border-purple-400/25 bg-black/20 px-3.5 py-2.5 text-left transition-colors hover:bg-black/30";
  const body = (
    <>
      <FileText size={17} className="shrink-0 text-purple-300" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-purple-100">{att.name}</span>
        {size && <span className="block text-[10px] text-purple-200/60">{size}</span>}
      </span>
      {busy ? <Loader2 size={15} className="shrink-0 animate-spin text-purple-300" /> : <Download size={15} className="shrink-0 text-purple-300" />}
    </>
  );
  if (att.dataUrl) {
    return (
      <a href={att.dataUrl} download={att.name} className={cardClass} data-testid="chat-attachment-file" aria-label={`${ui.download}: ${att.name}`}>
        {body}
      </a>
    );
  }
  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      saveBlob(await fetchMessageFile(att.messageId), att.name);
    } catch (_) {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button type="button" onClick={onDownload} disabled={busy} className={cardClass} data-testid="chat-attachment-file"
        aria-label={`${ui.download}: ${att.name}`}>
        {body}
      </button>
      {failed && <p className="mt-1 text-[11px] text-red-300/90" role="alert">{ui.downloadFailed}</p>}
    </div>
  );
}

export function AttachmentList({ attachments, lang = "tr", onOpenImage }) {
  if (!Array.isArray(attachments) || !attachments.length) return null;
  const ui = uiFor(lang);
  return (
    <div className="mt-2 space-y-2" data-testid="chat-attachments">
      {attachments.map((att, i) => (att.type === "image"
        ? <AttachmentImage key={`${att.messageId}-${i}`} att={att} ui={ui} onOpen={onOpenImage} />
        : <AttachmentFile key={`${att.messageId}-${i}`} att={att} ui={ui} lang={lang} />))}
    </div>
  );
}

// ---- What Luna did in the account (agent actions) ----

const ACTION_ICONS = {
  reminder_created: Bell,
  reminder_cancelled: BellOff,
  note_created: StickyNote,
  goal_added: Target,
  goal_completed: Trophy,
  memory_saved: Brain,
  memory_forgotten: Trash2,
  preference_set: SlidersHorizontal,
};

const chipClass = "inline-flex items-center gap-1.5 rounded-full border border-purple-400/30 bg-purple-400/10 px-2.5 py-1 "
  + "text-[11px] text-purple-100 transition-colors hover:bg-purple-400/20 hover:text-white disabled:opacity-60";

// A reminder's "Takvime ekle": Google Calendar's own add-event page (the user
// saves it there — no account link, no permission) and the .ics file every
// calendar app imports (fetched with the device's auth, then saved).
function CalendarButtons({ action, ui }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const onIcs = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      saveBlob(await fetchReminderIcs(action.icsId), "luna-reminder.ics");
    } catch (_) {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {action.googleUrl && (
          <a href={action.googleUrl} target="_blank" rel="noopener noreferrer nofollow" className={chipClass}
            data-testid="chat-action-google-calendar">
            <CalendarPlus size={12} className="shrink-0 text-purple-300" />
            {ui.addToCalendar}
          </a>
        )}
        {action.icsId && (
          <button type="button" onClick={onIcs} disabled={busy} className={chipClass} data-testid="chat-action-ics">
            {busy ? <Loader2 size={12} className="shrink-0 animate-spin text-purple-300" />
              : <Download size={12} className="shrink-0 text-purple-300" />}
            {ui.downloadIcs}
          </button>
        )}
      </div>
      {failed && <p className="mt-1 text-[11px] text-red-300/90" role="alert">{ui.downloadFailed}</p>}
    </div>
  );
}

function ActionCard({ action, ui, lang }) {
  const Icon = ACTION_ICONS[action.type] || Bell;
  const reminder = action.type === "reminder_created";
  const title = (reminder || action.type === "reminder_cancelled") && action.text ? action.text : action.summary;
  const when = reminder ? formatDue(action, lang) : "";
  const repeat = reminder && ui[action.recurrence] ? ui[action.recurrence] : "";
  return (
    <div className="rounded-xl border border-purple-400/25 bg-black/20 px-3.5 py-2.5" data-testid="chat-action-card"
      data-action-type={action.type}>
      <div className="flex items-start gap-2.5">
        <Icon size={16} className="mt-0.5 shrink-0 text-purple-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-purple-300/70">{ui[action.type]}</p>
          <p className="break-words text-xs font-medium text-purple-100">{title}</p>
          {(when || repeat) && (
            <p className="text-[11px] text-purple-200/70" data-testid="chat-action-when">
              {[when, repeat].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
      {reminder && (action.googleUrl || action.icsId) && <CalendarButtons action={action} ui={ui} />}
    </div>
  );
}

export function ActionCards({ actions, lang = "tr" }) {
  const list = normalizeActions(actions);
  // A fresh action (one this turn just did) also updates this device once:
  // the reminder alerts and a reply language Luna saved (lib/agentActions.js).
  useEffect(() => {
    applyActions(actions, { setReplyLang });
  }, [actions]);
  if (!list.length) return null;
  const ui = uiFor(lang);
  return (
    <div className="mt-2.5 space-y-2" data-testid="chat-actions">
      {list.map((a, i) => <ActionCard key={`${a.type}-${a.id}-${i}`} action={a} ui={ui} lang={lang} />)}
    </div>
  );
}

// (the same component under the name a caller may use for a list)
export const ActionList = ActionCards;
