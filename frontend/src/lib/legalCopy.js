// Confirmation copy shared by SettingsPanel and TermsGate — it must match
// what the backend actually does and what the marketing site's /hesap-silme
// and /acik-riza-metni pages say, so it lives in one place.

export const accountDeletionBody = (t) => t(
  "Hesabın ve ona bağlı veriler (sohbetler, anılar, günlük, notlar, hedefler, hatırlatıcılar ve ayarlar) kalıcı olarak silinir. Aktif bir aboneliğin varsa otomatik yenilemesi de sona erer. Ücretli paket aldıysan satın alma onay kayıtların yasal zorunluluk gereği 3 yıl saklanır. Bu işlem geri alınamaz.",
  "Your account and the data tied to it (chats, memories, journal, notes, goals, reminders and settings) will be permanently deleted. If you have an active subscription, its auto-renewal ends too. If you bought a paid plan, your purchase confirmation records are kept for 3 years as the law requires. This can't be undone."
);

export const consentWithdrawalBody = (t) => t(
  "İzni geri alırsan Luna'nın özel nitelikli olarak işaretlediği anıların ve tüm yapay zeka özetlerin silinir. 30 Eylül 2026'dan önce kaydedilen ya da kendi eklediğin anılar işaretlenmediği için silinmez; onları Anılarım'dan silebilirsin.",
  "If you withdraw it, the memories Luna flagged as special-category and all your AI summaries will be deleted. Memories saved before 30 September 2026 or added by you aren't flagged, so they stay; you can delete them in My Memories."
);
