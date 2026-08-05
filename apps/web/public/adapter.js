/**
 * WEWE ERP data adapter (Phase A) — feeds LIVE API data into the verbatim design's
 * render paths. This file is NOT part of the design bundle; the design files stay
 * byte-identical (scripts/check-design-verbatim.sh). The serve-time HTML transform in
 * vite.config.ts wraps three fixture consts with `window.__weweData.X || <fixture>`,
 * so when this adapter can't reach the API the design falls back to its own fixtures.
 *
 * Synchronous XHR is deliberate here: the design compiles its consts at boot, so data
 * must exist before support.js runs. This is a dev-bridge pattern; the production
 * adapter will move to an async boot gate.
 */
(function () {
  function xhr(method, url, body) {
    try {
      var r = new XMLHttpRequest();
      r.open(method, url, false); // sync — see note above
      r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
      if (r.status < 200 || r.status >= 300) return null;
      return JSON.parse(r.responseText);
    } catch (e) { return null; }
  }

  // Demo bridge: ensure an API session so live data loads. The design's own sign-in
  // stays untouched (persona switcher is a design feature); real per-user auth wiring
  // is the next adapter phase.
  var me = xhr('GET', '/v1/auth/me');
  if (!me) {
    xhr('POST', '/v1/auth/login', { email: 'admin@wewe.org', password: 'Password1!' });
    me = xhr('GET', '/v1/auth/me');
  }
  if (!me) return; // API down → design renders its fixtures, nothing breaks

  function naira(kobo) { return Number(BigInt(kobo || '0') / 100n); }
  function ddmmyyyy(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  function agoText(iso) {
    var h = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 3600000));
    return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }
  var ROLE_LABEL = { SUPERVISOR: 'Supervisor', INTERNAL_AUDIT: 'Internal Audit', FINANCE: 'Finance', FINAL_APPROVER: 'Final Approver', HR_OFFICER: 'HR' };

  var data = {};

  var reqs = xhr('GET', '/v1/requisitions?scope=all');
  if (Array.isArray(reqs) && reqs.length) {
    data.TXNS = reqs.map(function (t) {
      var status = String(t.status || '').toLowerCase();
      if (status === 'pending') status = 'pending';
      var stage = t.status === 'APPROVED' ? 5 : (Number(t.currentStage || 0) + 1);
      var aging = '';
      if (t.status === 'PENDING') aging = agoText(t.updatedAt) + ' at ' + (ROLE_LABEL[t.stageRole] || t.stageRole || '—');
      else if (t.status === 'APPROVED') aging = 'Closed ' + ddmmyyyy(t.updatedAt);
      else if (t.status === 'RETURNED') aging = 'Returned ' + agoText(t.updatedAt) + ' ago';
      else if (t.status === 'REJECTED') aging = 'Rejected ' + ddmmyyyy(t.updatedAt);
      else aging = '—';
      return {
        ref: t.ref, title: t.title, who: t.initiator, dept: t.department,
        donor: t.donorCode || 'Core', amount: naira(t.amountKobo),
        stage: stage, status: status, aging: aging,
        date: ddmmyyyy(t.submittedAt || t.updatedAt),
      };
    });
  }

  var pos = xhr('GET', '/v1/budgets/position');
  if (Array.isArray(pos) && pos.length) {
    data.BUDGET_ROWS = pos.map(function (b) {
      return {
        line: b.name || b.code,
        dept: (b.department && b.department.name) || '',
        donor: b.donorCode || 'Core',
        alloc: naira(b.allocatedKobo || b.allocated),
        comm: naira(b.committedKobo || b.committed),
        actual: naira(b.actualKobo || b.actual),
      };
    });
  }

  var qb = xhr('GET', '/v1/qb/outbox?status=ERROR');
  var qbRows = Array.isArray(qb) ? qb : (qb && (qb.rows || qb.items)) || null;
  if (qbRows) {
    data.QB_EXCEPTIONS = qbRows.map(function (e) {
      return {
        ref: (e.payload && e.payload.ref) || e.txId || e.id,
        posted: ddmmyyyy(e.createdAt),
        err: e.error || 'Sync error',
        amount: naira((e.payload && e.payload.amountKobo) || '0'),
      };
    });
  }

  window.__weweData = data;
})();
