// Tiny vibrations for the voice call, so the turns can be felt with the phone
// held low or lying on a table. Android Chrome (and the TWA) only; elsewhere
// navigator.vibrate is missing and these do nothing. Chrome also ignores them
// before the first tap on the page, which is fine — the call starts with one.

const buzz = (pattern) => {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch (_) {}
};

export const haptics = {
  // The mic is really open — your turn.
  tick: () => buzz(10),
  // Your words were sent.
  doubleTick: () => buzz([8, 60, 8]),
  // Something went wrong (mic blocked, network…).
  error: () => buzz([30, 50, 30]),
};
