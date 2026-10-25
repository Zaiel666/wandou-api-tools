/* Test-canvas mascot: drag the existing launcher, never replace its chat action. */
(() => {
  const button = document.getElementById('assistantToggleButton');
  if (!button) return;
  const key = 'wandou-canvas-test-mascot-position-v1';
  let gesture = null, suppressClick = false;
  function place(x, y) {
    const rect = button.getBoundingClientRect();
    const left = Math.max(0, Math.min(x, Math.max(0, window.innerWidth - rect.width)));
    const top = Math.max(0, Math.min(y, Math.max(0, window.innerHeight - rect.height)));
    button.style.left = left + 'px'; button.style.top = top + 'px';
    button.style.right = 'auto'; button.style.bottom = 'auto';
    button.dataset.mascotPositioned = 'true';
    return {left, top};
  }
  function save(position) {
    try { window.localStorage.setItem(key, JSON.stringify(position)); } catch (_) {}
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(key));
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) place(saved.left, saved.top);
  } catch (_) {}
  button.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.isPrimary === false) return;
    suppressClick = false;
    const rect = button.getBoundingClientRect();
    gesture = {id:e.pointerId, x:e.clientX, y:e.clientY, left:rect.left, top:rect.top, moved:false};
    button.setPointerCapture?.(e.pointerId);
  });
  button.addEventListener('pointermove', e => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true; suppressClick = true;
    button.dataset.mascotDragging = 'true';
    place(gesture.left + dx, gesture.top + dy);
    e.preventDefault(); e.stopPropagation();
  });
  function finish(e) {
    if (!gesture || gesture.id !== e.pointerId) return;
    if (gesture.moved) save(place(parseFloat(button.style.left), parseFloat(button.style.top)));
    gesture = null;
    delete button.dataset.mascotDragging;
    if (button.hasPointerCapture?.(e.pointerId)) button.releasePointerCapture(e.pointerId);
  }
  button.addEventListener('pointerup', finish);
  button.addEventListener('pointercancel', finish);
  button.addEventListener('lostpointercapture', finish);
  button.addEventListener('click', e => {
    if (suppressClick && e.detail !== 0) {
      suppressClick = false; e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  // Alt + arrows provides keyboard positioning without stealing Enter/Space.
  button.addEventListener('keydown', e => {
    if (!e.altKey || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const rect = button.getBoundingClientRect();
    const delta = {ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];
    save(place(rect.left + delta[0], rect.top + delta[1]));
  });
  window.addEventListener('resize', () => {
    if (button.dataset.mascotPositioned) save(place(parseFloat(button.style.left), parseFloat(button.style.top)));
  });
})();
