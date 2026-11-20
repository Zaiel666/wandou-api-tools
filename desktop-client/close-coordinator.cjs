'use strict';

// Owns only close intent. It never treats a timer, lost renderer or failed save
// as permission to discard edits. The emergency decision is made in native UI.
function createCloseCoordinator({ isCritical, requestSave, recover, finish, schedule = setTimeout, cancelTimer = clearTimeout, now = Date.now, acknowledgementMs = 15000, savingMs = 60000 }) {
  let sequence = 0, active = 0, timer = null, recovery = null, ending = false, saveSent = false;
  const clear = () => { if (timer !== null) cancelTimer(timer); timer = null; };
  const arm = delay => { clear(); timer = schedule(() => { timer = null; void emergency(); }, delay); timer?.unref?.(); };
  async function emergency() {
    if (!active || ending) return false;
    if (recovery) return recovery;
    const requestId = active;
    recovery = Promise.resolve().then(async () => {
      try {
        const blocked = Boolean(isCritical());
        const accepted = await recover({ requestId, blocked });
        if (requestId !== active || ending) return false;
        // Re-check after the native dialog: a migration may have begun while
        // the user was deciding. Never force exit during a protected handoff.
        if (accepted && !blocked && !isCritical()) { ending = true; clear(); finish({ forced: true }); return true; }
        arm(savingMs);
        return false;
      } catch (_) { if (requestId === active && !ending) arm(savingMs); return false; }
      finally { recovery = null; }
    });
    return recovery;
  }
  return {
    request() {
      if (ending) return active;
      if (active) {
        if (!saveSent && !isCritical()) {
          saveSent = true; arm(acknowledgementMs);
          try { requestSave({ requestId: active }); } catch (_) { void emergency(); }
        } else void emergency();
        return active;
      }
      active = ++sequence;
      saveSent = false;
      arm(acknowledgementMs);
      if (isCritical()) { void emergency(); return active; }
      saveSent = true;
      try { requestSave({ requestId: active }); } catch (_) { void emergency(); }
      return active;
    },
    state({ requestId, phase } = {}) {
      if (requestId !== active || !active || ending) return false;
      if (phase === 'saving') arm(savingMs);
      else if (phase === 'failed') clear();
      else return false;
      return true;
    },
    cancel() { if (ending) return; clear(); active = 0; saveSent = false; },
    confirm({ requestId, saveVerified, verifiedAt, savedWorkflowCount } = {}) {
      const age = now() - verifiedAt;
      // Electron's renderer/main wall-clock samples can differ by a few ms.
      // Permit only a small precision skew; intent ID and stale age stay strict.
      if (!active || requestId !== active || ending || isCritical() || saveVerified !== true || !Number.isFinite(verifiedAt) || age < -100 || age > 30000 || !Number.isSafeInteger(savedWorkflowCount) || savedWorkflowCount < 0) return false;
      ending = true; clear(); finish({ forced: false }); return true;
    },
    emergency,
    pending: () => Boolean(active),
    dispose() { clear(); active = 0; ending = true; }
  };
}

function withTimeout(task, milliseconds, message) {
  let timer;
  return Promise.race([Promise.resolve(task), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
}
module.exports = { createCloseCoordinator, withTimeout };
