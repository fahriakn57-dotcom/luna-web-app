import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { fetchGoals, createGoal, editGoal, toggleGoal, deleteGoal } from "@/lib/api";
import { Panel, PanelHeader, PanelBody, IconButton, Segmented, SectionLabel, ErrorState, usePanelTitleId } from "@/components/panel/Panel";
import ConfirmDialog from "@/components/ConfirmDialog";
import { addDays, formatDate } from "@/lib/dates";
import {
  PROGRESS_DEBOUNCE_MS, LINGER_MS, DEFAULT_CATEGORIES, BUCKETS, enqueue, normalize, withSteps, cleanSteps,
  sameSteps, bucketOf, byDeadline, byCompleted, emptyDraft, draftFrom, isDraftDirty, isEditDirty, errorDetail,
} from "@/components/goals/goalModel";
import {
  groupListClass, AddForm, ItemEditor, GoalCard, PlanRow, CompletedSection, GoalStats, TabEmpty, GoalsSkeleton,
} from "@/components/goals/GoalParts";

export default function GoalsPanel({ lang, onClose }) {
  const t = (tr, en) => (lang === "tr" ? tr : en);
  const titleId = usePanelTitleId();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [status, setStatus] = useState("loading"); // "loading" | "error" | "ready"
  const [tab, setTab] = useState("goal"); // "goal" | "plan"
  const [form, setForm] = useState(null); // add-form draft, null while closed
  const [formFocus, setFormFocus] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // { id, draft }
  // { kind: "delete", item } | { kind: "discard", then: "collapse" | "close" | "edit", item? }
  const [confirm, setConfirm] = useState(null);
  const [completedOpen, setCompletedOpen] = useState({ goal: false, plan: false });
  const [lingering, setLingering] = useState(() => new Set());

  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Bumped on every local change, so a slower response never overwrites a
  // newer optimistic state (or reverts it).
  const versions = useRef(new Map());
  // Last state the server confirmed per item. A failed request reverts to
  // this, not to the state just before it — that one may hold an earlier
  // optimistic change that failed too.
  const serverState = useRef(new Map());
  const queues = useRef(new Map());
  const pendingProgress = useRef(new Map()); // id -> { timer, before, value, errorTitle }
  const lingerTimers = useRef(new Map());
  const savingRef = useRef(false);
  const focusReturn = useRef(null);
  const hadForm = useRef(false);

  const defaultCategory = categories.includes("kişisel") ? "kişisel" : categories[0] || "kişisel";

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await fetchGoals();
      const list = (data.goals || []).map(normalize);
      serverState.current = new Map(list.map((item) => [item.id, item]));
      setItems(list);
      if (Array.isArray(data.categories) && data.categories.length) setCategories(data.categories);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Save a slider change that's still waiting for its debounce when the
  // panel closes; drop pending timers.
  useEffect(() => {
    const pending = pendingProgress.current;
    const timers = lingerTimers.current;
    const requestQueues = queues.current;
    return () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        enqueue(requestQueues, id, () => editGoal(id, { progress: entry.value })).catch(() => toast.error(entry.errorTitle));
      }
      pending.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const view = useMemo(() => {
    const isActive = (item) => !item.done || lingering.has(item.id);
    const goals = items.filter((item) => item.kind === "goal");
    const plans = items.filter((item) => item.kind === "plan");
    const activeGoals = goals.filter(isActive).sort(byDeadline);
    const activePlans = plans.filter(isActive).sort(byDeadline);
    return {
      activeGoals,
      doneGoals: goals.filter((g) => !isActive(g)).sort(byCompleted),
      planGroups: BUCKETS
        .map((bucket) => ({ ...bucket, items: activePlans.filter((p) => bucketOf(p) === bucket.key) }))
        .filter((group) => group.items.length > 0),
      donePlans: plans.filter((p) => !isActive(p)).sort(byCompleted),
      counts: { goal: goals.filter((g) => !g.done).length, plan: plans.filter((p) => !p.done).length },
    };
  }, [items, lingering]);

  const findItem = (id) => itemsRef.current.find((item) => item.id === id);

  // Something that just turned done (toggle, last step, slider at 100%) stays
  // in its list for a moment before moving to "Tamamlananlar". Marked in the
  // same update as the change itself, so the card never remounts and its
  // check animation plays.
  const linger = (id) => {
    setLingering((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    clearTimeout(lingerTimers.current.get(id));
    lingerTimers.current.set(id, setTimeout(() => {
      lingerTimers.current.delete(id);
      setLingering((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, LINGER_MS));
  };

  const applyLocal = (id, next) => {
    versions.current.set(id, (versions.current.get(id) || 0) + 1);
    if (next.done && !findItem(id)?.done) linger(id);
    setItems((list) => list.map((item) => (item.id === id ? next : item)));
  };

  const persist = async (id, before, request, messages, onFail) => {
    const version = versions.current.get(id);
    try {
      const saved = await enqueue(queues.current, id, request);
      if (saved?.id !== id) return;
      const doc = normalize(saved);
      serverState.current.set(id, doc);
      if (versions.current.get(id) === version) {
        if (doc.done && !findItem(id)?.done) linger(id);
        // Celebrate once the server has it, not on the optimistic tick.
        if (doc.done && !before.done && doc.kind === "goal") {
          toast.success(t("Tebrikler, bir hedefini tamamladın!", "Congrats, you reached a goal!"), { description: doc.title });
        }
        setItems((list) => list.map((item) => (item.id === id ? doc : item)));
      }
    } catch (err) {
      if (err?.response?.status === 404) {
        serverState.current.delete(id);
        const known = !!findItem(id);
        setItems((list) => list.filter((item) => item.id !== id));
        if (known) {
          toast.error(t("Bu kayıt artık yok", "This item no longer exists"), {
            description: t("Başka bir cihazdan silinmiş olabilir.", "It may have been deleted on another device."),
          });
        }
        return;
      }
      if (versions.current.get(id) === version) {
        const restore = serverState.current.get(id) || before;
        setItems((list) => list.map((item) => (item.id === id ? restore : item)));
        onFail?.();
      }
      toast.error(messages.title, {
        description: errorDetail(err, lang, messages.description || t("Önceki haline döndü. Bağlantını kontrol edip tekrar dene.", "It was put back as it was. Check your connection and try again.")),
      });
    }
  };

  const cancelPendingProgress = (id) => {
    const entry = pendingProgress.current.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingProgress.current.delete(id);
  };

  const changeProgress = (id, value) => {
    const current = findItem(id);
    if (!current) return;
    let entry = pendingProgress.current.get(id);
    if (!entry) {
      entry = { before: current };
      pendingProgress.current.set(id, entry);
    }
    clearTimeout(entry.timer);
    entry.value = value;
    entry.errorTitle = t("İlerleme kaydedilemedi", "Couldn't save your progress");
    applyLocal(id, { ...current, progress: value });
    entry.timer = setTimeout(() => {
      pendingProgress.current.delete(id);
      persist(id, entry.before, () => editGoal(id, { progress: value }), { title: entry.errorTitle });
    }, PROGRESS_DEBOUNCE_MS);
  };

  const toggleDone = (id) => {
    const before = findItem(id);
    if (!before) return;
    cancelPendingProgress(id);
    const done = !before.done;
    const next = before.steps.length
      ? { ...before, done, steps: before.steps.map((s) => ({ ...s, done })), progress: done ? 100 : 0 }
      : { ...before, done, progress: done ? 100 : before.progress };
    applyLocal(id, next);
    persist(id, before, () => toggleGoal(id), { title: t("Durum güncellenemedi", "Couldn't update the status") });
  };

  const toggleStep = (id, stepId) => {
    const before = findItem(id);
    if (!before) return;
    cancelPendingProgress(id);
    const steps = before.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s));
    applyLocal(id, withSteps(before, steps));
    persist(id, before, () => editGoal(id, { steps }), { title: t("Adım güncellenemedi", "Couldn't update the step") });
  };

  // Every confirm remembers what had focus, so cancelling puts it back.
  const ask = (next) => {
    focusReturn.current = document.activeElement;
    setConfirm(next);
  };

  const openEditor = (item) => {
    const latest = findItem(item.id) || item;
    setEditing({ id: latest.id, draft: draftFrom(latest) });
  };

  // Opening a second editor would silently drop unsaved changes in the first.
  const startEdit = (item) => {
    if (editing && editing.id !== item.id && isEditDirty(editing.draft, findItem(editing.id))) {
      ask({ kind: "discard", then: "edit", item });
    } else {
      openEditor(item);
    }
  };
  const patchEdit = (patch) => setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));

  const saveEdit = () => {
    if (!editing) return;
    const { id, draft } = editing;
    const before = findItem(id);
    if (!before) {
      setEditing(null);
      return;
    }
    const title = draft.title.trim();
    if (!title) return;
    const steps = cleanSteps(draft.steps, draft.stepDraft);
    const description = draft.description.trim();
    const patch = {};
    if (title !== before.title) patch.title = title;
    if (description !== before.description) patch.description = description;
    // The API clears the date on "" (null would mean "unchanged").
    if ((draft.deadline || "") !== (before.deadline || "")) patch.deadline = draft.deadline || "";
    if (before.kind === "goal" && draft.category !== before.category) patch.category = draft.category;
    if (!sameSteps(steps, before.steps)) patch.steps = steps;
    setEditing(null);
    if (!Object.keys(patch).length) return;
    cancelPendingProgress(id);
    let next = { ...before, ...patch, deadline: "deadline" in patch ? patch.deadline || null : before.deadline };
    if (patch.steps) next = withSteps(next, patch.steps);
    applyLocal(id, next);
    persist(id, before, () => editGoal(id, patch), {
      title: t("Değişiklik kaydedilemedi", "Couldn't save your changes"),
      description: t("Önceki haline döndü; düzenlemen açık duruyor. Bağlantını kontrol edip tekrar dene.",
        "It was put back and your edit is still open. Check your connection and try again."),
    }, () => setEditing((current) => current || { id, draft }));
  };

  const removeItem = async (item) => {
    cancelPendingProgress(item.id);
    if (editing?.id === item.id) setEditing(null);
    const snapshot = findItem(item.id) || item;
    versions.current.set(item.id, (versions.current.get(item.id) || 0) + 1);
    setItems((list) => list.filter((g) => g.id !== item.id));
    try {
      // Queued behind any save still in flight for this item.
      await enqueue(queues.current, item.id, () => deleteGoal(item.id));
      serverState.current.delete(item.id);
      toast.success(item.kind === "plan" ? t("Plan silindi", "Plan deleted") : t("Hedef silindi", "Goal deleted"));
    } catch (err) {
      // Already gone on the server (e.g. deleted on another device).
      if (err?.response?.status === 404) {
        serverState.current.delete(item.id);
        return;
      }
      const restore = serverState.current.get(item.id) || snapshot;
      setItems((list) => (list.some((g) => g.id === restore.id) ? list : [...list, restore]));
      toast.error(t("Silinemedi", "Couldn't delete it"), {
        description: t("Listende duruyor. Bağlantını kontrol edip tekrar dene.", "It's still in your list. Check your connection and try again."),
      });
    }
  };

  const openForm = (kind, title = "") => {
    setForm((current) => (current && isDraftDirty(current)
      ? { ...current, kind, title: title || current.title }
      : emptyDraft(kind, title, defaultCategory)));
    setFormFocus((n) => n + 1);
  };

  const patchForm = (patch) => setForm((current) => (current ? { ...current, ...patch } : current));

  const cancelForm = () => {
    if (form && isDraftDirty(form)) ask({ kind: "discard", then: "collapse" });
    else setForm(null);
  };

  // A pristine form follows the tab; one with writing in it keeps its kind.
  const changeTab = (next) => {
    setTab(next);
    setForm((current) => (current && current.kind !== next && !isDraftDirty(current) ? { ...current, kind: next } : current));
  };

  const submitForm = async () => {
    // The ref (not `saving`) stops a second Enter / Ctrl+Enter that lands
    // before the re-render from creating a duplicate.
    if (!form || savingRef.current) return;
    const title = form.title.trim();
    if (!title) {
      setFormFocus((n) => n + 1);
      return;
    }
    const kind = form.kind;
    savingRef.current = true;
    setSaving(true);
    try {
      const created = normalize(await createGoal({
        title,
        category: form.category,
        description: form.description.trim(),
        deadline: form.deadline || null,
        kind,
        steps: cleanSteps(form.steps, form.stepDraft),
      }));
      serverState.current.set(created.id, created);
      setItems((list) => [created, ...list.filter((item) => item.id !== created.id)]);
      setForm(null);
      setTab(created.kind);
      toast.success(created.kind === "plan" ? t("Plan eklendi", "Plan added") : t("Hedef eklendi", "Goal added"));
    } catch (err) {
      toast.error(kind === "plan" ? t("Plan kaydedilemedi", "Couldn't save the plan") : t("Hedef kaydedilemedi", "Couldn't save the goal"), {
        description: errorDetail(err, lang, t("Yazdıkların duruyor. Bağlantını kontrol edip tekrar dene.", "What you wrote is still here. Check your connection and try again.")),
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Closing with unsaved writing asks first instead of losing it.
  const requestClose = () => {
    const formDirty = form && isDraftDirty(form);
    const editDirty = editing && isEditDirty(editing.draft, findItem(editing.id));
    if (formDirty || editDirty) ask({ kind: "discard", then: "close" });
    else onClose();
  };

  const onConfirm = () => {
    if (!confirm) return;
    const current = confirm;
    setConfirm(null);
    if (current.kind === "delete") removeItem(current.item);
    else if (current.then === "close") onClose();
    else if (current.then === "edit") openEditor(current.item);
    else setForm(null);
  };

  // "Düzenlemeye devam et" goes back into the form / editor being protected.
  const onCancelConfirm = () => {
    const current = confirm;
    setConfirm(null);
    if (current?.then === "collapse" && form) setFormFocus((n) => n + 1);
    if (current?.then === "edit") focusReturn.current = document.querySelector('[data-testid="goal-edit-title-input"]');
  };

  // Keep keyboard focus inside the panel when the focused control goes away
  // (a completed item moving to "Tamamlananlar", a deleted card, the add
  // form or a confirm closing) — otherwise it falls to <body>.
  useEffect(() => {
    const formClosed = hadForm.current && !form;
    hadForm.current = !!form;
    if (confirm) return;
    const back = focusReturn.current;
    focusReturn.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const dialog = document.getElementById(titleId)?.closest('[role="dialog"]');
    if (!dialog) return;
    const target = (back?.isConnected && dialog.contains(back) && back)
      || (formClosed && dialog.querySelector('[data-testid="goal-add-toggle"]'))
      || dialog;
    target.focus({ preventScroll: true });
  });

  let confirmCopy;
  if (confirm?.kind === "delete") {
    const isPlan = confirm.item.kind === "plan";
    const name = `“${confirm.item.title}”`;
    confirmCopy = {
      title: isPlan ? t("Bu plan silinsin mi?", "Delete this plan?") : t("Bu hedef silinsin mi?", "Delete this goal?"),
      body: confirm.item.steps.length
        ? t(`${name} ve adımları kalıcı olarak silinecek. Bu işlem geri alınamaz.`, `${name} and its steps will be deleted for good. This can't be undone.`)
        : t(`${name} kalıcı olarak silinecek. Bu işlem geri alınamaz.`, `${name} will be deleted for good. This can't be undone.`),
      confirmLabel: t("Sil", "Delete"),
      cancelLabel: t("Vazgeç", "Cancel"),
    };
  } else if (confirm?.then === "close") {
    confirmCopy = {
      title: t("Kaydetmeden kapatılsın mı?", "Close without saving?"),
      body: t("Henüz kaydetmediğin bilgiler kaybolacak.", "What you haven't saved yet will be lost."),
      confirmLabel: t("Kapat", "Close"),
      cancelLabel: t("Düzenlemeye devam et", "Keep editing"),
    };
  } else if (confirm?.then === "edit") {
    confirmCopy = {
      title: t("Değişikliklerden vazgeçilsin mi?", "Discard your changes?"),
      body: t("Düzenlediğin kayıttaki kaydedilmemiş değişiklikler kaybolacak.", "Your unsaved changes to the item you were editing will be lost."),
      confirmLabel: t("Değişikliklerden vazgeç", "Discard changes"),
      cancelLabel: t("Düzenlemeye devam et", "Keep editing"),
    };
  } else {
    confirmCopy = {
      title: t("Taslak silinsin mi?", "Discard this draft?"),
      body: t("Henüz kaydetmediğin bilgiler kaybolacak.", "What you haven't saved yet will be lost."),
      confirmLabel: t("Taslağı sil", "Discard"),
      cancelLabel: t("Düzenlemeye devam et", "Keep editing"),
    };
  }

  const ready = status === "ready";
  const { counts } = view;

  let subtitle = t("Uzun vadeli hedeflerin ve tarihli planların tek yerde.", "Your long-term goals and dated plans, in one place.");
  if (ready && (counts.goal || counts.plan)) {
    const parts = [];
    if (counts.goal) parts.push(t(`${counts.goal} aktif hedef`, `${counts.goal} active ${counts.goal === 1 ? "goal" : "goals"}`));
    if (counts.plan) parts.push(t(`${counts.plan} plan`, `${counts.plan} ${counts.plan === 1 ? "plan" : "plans"}`));
    subtitle = parts.join(", ");
  } else if (ready && items.length) {
    subtitle = t("Hepsi tamamlandı. Sıradakini eklemeye hazır mısın?", "Everything's done. Ready for the next one?");
  }

  const editorFor = (item) => (editing?.id === item.id ? (
    <ItemEditor t={t} lang={lang} draft={editing.draft} onPatch={patchEdit} categories={categories}
      onCancel={() => setEditing(null)} onSave={saveEdit} />
  ) : null);

  const renderGoal = (goal) => (
    <GoalCard key={goal.id} t={t} lang={lang} goal={goal} editor={editorFor(goal)}
      onToggle={() => toggleDone(goal.id)}
      onToggleStep={(stepId) => toggleStep(goal.id, stepId)}
      onProgress={(value) => changeProgress(goal.id, value)}
      onEdit={() => startEdit(goal)}
      onDelete={() => ask({ kind: "delete", item: goal })} />
  );

  const renderPlan = (plan, bucket) => (
    <PlanRow key={plan.id} t={t} lang={lang} plan={plan} bucket={bucket} editor={editorFor(plan)}
      onToggle={() => toggleDone(plan.id)}
      onToggleStep={(stepId) => toggleStep(plan.id, stepId)}
      onEdit={() => startEdit(plan)}
      onDelete={() => ask({ kind: "delete", item: plan })} />
  );

  const toggleCompleted = (kind) => setCompletedOpen((current) => ({ ...current, [kind]: !current[kind] }));

  let content;
  if (status === "loading") {
    content = <GoalsSkeleton label={t("Hedeflerin ve planların yükleniyor", "Loading your goals and plans")} />;
  } else if (status === "error") {
    content = (
      <ErrorState
        title={t("Hedeflerin ve planların yüklenemedi", "Couldn't load your goals and plans")}
        body={t("Bağlantında bir sorun olabilir. Birazdan tekrar dene.", "There may be a connection problem. Try again in a moment.")}
        onRetry={load}
        retryLabel={t("Tekrar dene", "Try again")}
      />
    );
  } else if (tab === "goal") {
    content = (
      <div className="space-y-4">
        {view.activeGoals.length > 0 && (
          <GoalStats t={t} lang={lang} active={view.activeGoals} doneCount={view.doneGoals.length} />
        )}
        {view.activeGoals.length === 0 ? (
          <TabEmpty t={t} kind="goal" hasDone={view.doneGoals.length > 0} showCta={!form}
            onCreate={(title) => openForm("goal", title)} />
        ) : (
          <div className="space-y-2.5">{view.activeGoals.map(renderGoal)}</div>
        )}
        {view.doneGoals.length > 0 && (
          <CompletedSection t={t} count={view.doneGoals.length} open={completedOpen.goal} onToggle={() => toggleCompleted("goal")}>
            <div className="space-y-2.5">{view.doneGoals.map(renderGoal)}</div>
          </CompletedSection>
        )}
      </div>
    );
  } else {
    const dayLabel = (offset) => formatDate(addDays(new Date(), offset), lang, { weekday: "long", day: "numeric", month: "long" });
    content = (
      <div className="space-y-5">
        {view.planGroups.length === 0 ? (
          <TabEmpty t={t} kind="plan" hasDone={view.donePlans.length > 0} showCta={!form}
            onCreate={(title) => openForm("plan", title)} />
        ) : view.planGroups.map((group) => (
          <section key={group.key} data-testid={`plan-group-${group.key}`}>
            <SectionLabel action={<span className="text-xs tabular-nums text-white/30">{group.items.length}</span>}>
              <span className={group.key === "overdue" ? "text-rose-300/90" : undefined}>{t(group.tr, group.en)}</span>
              {(group.key === "today" || group.key === "tomorrow") && (
                <span className="ml-1.5 font-normal text-white/30">{dayLabel(group.key === "today" ? 0 : 1)}</span>
              )}
            </SectionLabel>
            <ul className={groupListClass}>{group.items.map((plan) => renderPlan(plan, group.key))}</ul>
          </section>
        ))}
        {view.donePlans.length > 0 && (
          <CompletedSection t={t} count={view.donePlans.length} open={completedOpen.plan} onToggle={() => toggleCompleted("plan")}>
            <ul className={groupListClass}>{view.donePlans.map((plan) => renderPlan(plan, null))}</ul>
          </CompletedSection>
        )}
      </div>
    );
  }

  // On phones the title wraps; the no-break space keeps "&" off the start of
  // the second line.
  const panelTitle = t("Hedeflerim & Planlarım", "Goals & Plans");
  const addLabel = form
    ? t("Formu kapat", "Close form")
    : tab === "plan" ? t("Yeni plan ekle", "Add a plan") : t("Yeni hedef ekle", "Add a goal");

  return (
    <Panel onClose={requestClose} size="xl" accent="emerald" labelledBy={titleId} testId="goals-panel">
      <PanelHeader
        glyph="goals"
        accent="emerald"
        title={panelTitle}
        subtitle={subtitle}
        titleId={titleId}
        onClose={requestClose}
        closeLabel={t("Kapat", "Close")}
        actions={(
          // While the form is open its own save button is the primary action;
          // the toggle steps back instead of turning into a second "×".
          <IconButton variant={form ? "soft" : "primary"} size={40} label={addLabel} testId="goal-add-toggle"
            onClick={() => (form ? cancelForm() : openForm(tab))}>
            <Plus size={18} />
          </IconButton>
        )}
      />
      <PanelBody className="space-y-5">
        {form && (
          <AddForm t={t} lang={lang} draft={form} onPatch={patchForm} categories={categories} saving={saving}
            focusSignal={formFocus} onCancel={cancelForm} onSubmit={submitForm} />
        )}

        <Segmented
          label={t("Görünüm", "View")}
          value={tab}
          onChange={changeTab}
          testIdPrefix="goals-tab"
          options={[
            { value: "goal", label: t("Hedefler", "Goals"), icon: Target, count: ready ? counts.goal : undefined },
            { value: "plan", label: t("Planlar", "Plans"), icon: CalendarCheck, count: ready ? counts.plan : undefined },
          ]}
        />

        {content}
      </PanelBody>

      <ConfirmDialog
        open={!!confirm}
        danger
        title={confirmCopy.title}
        body={confirmCopy.body}
        confirmLabel={confirmCopy.confirmLabel}
        cancelLabel={confirmCopy.cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancelConfirm}
      />
    </Panel>
  );
}
