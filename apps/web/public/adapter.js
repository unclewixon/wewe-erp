/**
 * WEWE ERP data adapter (Phase B) — feeds LIVE API data into the verbatim design's
 * render paths. NOT a design file; the design bundle stays byte-identical (cmp guard).
 *
 * Authentication: the session is created by the person signing in, never by this file.
 * The design's sign-in screen is presentational — it only flips local state and never
 * calls the engine — so the real credential check is bridged here: the form is
 * intercepted, the credentials go to /v1/auth/login (argon2 + lockout + per-IP throttle
 * + TOTP when enrolled), and nothing loads until the engine has issued a session cookie.
 * To work as a given persona, sign in as that person.
 *
 * Synchronous XHR is deliberate: the design compiles its consts at boot, so data must
 * exist before support.js runs.
 */
(function () {
  function xhr(method, url, body) {
    try {
      var r = new XMLHttpRequest();
      r.open(method, url, false);
      r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
      if (r.status < 200 || r.status >= 300) return null;
      return JSON.parse(r.responseText);
    } catch (e) { return null; }
  }
  // Same call, but keeps the engine's own message on failure so we can show it verbatim.
  function xhrDetailed(method, url, body) {
    var r = new XMLHttpRequest();
    try {
      r.open(method, url, false); r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
    } catch (e) { return { ok: false, message: 'Could not reach the server.' }; }
    var parsed = null; try { parsed = JSON.parse(r.responseText); } catch (e) { /* non-JSON */ }
    if (r.status >= 200 && r.status < 300) return { ok: true, body: parsed };
    var m = parsed && parsed.message;
    if (Array.isArray(m)) m = m.join('; ');
    return { ok: false, message: m || 'Sign-in failed (HTTP ' + r.status + ')' };
  }

  function findButton(label) {
    var bs = document.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].offsetParent !== null && bs[i].textContent.trim() === label) return bs[i];
    }
    return null;
  }
  function textInputs() {
    return [].slice.call(document.querySelectorAll('input')).filter(function (i) {
      var t = (i.type || 'text').toLowerCase();
      return i.offsetParent !== null && t !== 'checkbox' && t !== 'radio' && t !== 'hidden';
    });
  }
  function showAuthError(msg) {
    var id = 'wewe-auth-error', el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('role', 'alert');
      el.style.cssText = 'margin:12px 0 0;padding:11px 14px;border-radius:10px;background:#FBEAE4;' +
        'border:1px solid #F0C4B4;color:#9C3309;font-size:13px;line-height:1.5;';
      var btn = findButton('Continue') || findButton('Verify and sign in');
      if (btn && btn.parentElement) btn.parentElement.appendChild(el); else document.body.appendChild(el);
    }
    el.textContent = msg;
  }
  function clearAuthError() {
    var el = document.getElementById('wewe-auth-error');
    if (el && el.parentElement) el.parentElement.removeChild(el);
  }

  // No session: hold the door. The design's screens still render, but its Continue /
  // Verify buttons are intercepted so they cannot advance on presentation alone.
  // Phase 1.11 binds the sign-in fields (siEmail / siPass with onChange), so the clone
  // surgery that used to live here — replacing both inputs to strip React's listeners
  // because they were fixed literals — is no longer needed. Their values can simply be
  // read at click time. The interception below stays: the design still has no SignIn
  // hook, so its buttons would otherwise advance on presentation alone.
  function installSignInGate() {
    var pendingToken = null, passThrough = false;
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn) return;
      if (passThrough) { passThrough = false; return; } // our own re-dispatch — let it reach the design
      var label = btn.textContent.trim();

      if (label === 'Continue') {
        var ins = textInputs();
        var emailEl = null, passEl = null;
        for (var i = 0; i < ins.length; i++) {
          var t = (ins[i].type || 'text').toLowerCase();
          if (t === 'password' && !passEl) passEl = ins[i];
          else if (!emailEl && t !== 'password') emailEl = ins[i];
        }
        if (!emailEl || !passEl) return; // not the sign-in form — leave it alone
        ev.stopPropagation(); ev.preventDefault();
        var mail = String(emailEl.value || '').trim(), pw = String(passEl.value || '');
        if (!mail || !pw) return showAuthError('Enter your work email and password.');
        clearAuthError();
        var res = xhrDetailed('POST', '/v1/auth/login', { email: mail, password: pw });
        if (!res.ok) return showAuthError(res.message);
        if (res.body && res.body.requires2fa) {
          // Password accepted, second factor still owed. Let the design show its own 2FA
          // screen by re-dispatching the click, this time without intercepting it.
          pendingToken = res.body.pendingToken;
          clearAuthError();
          passThrough = true;
          btn.click();
          return;
        }
        return location.reload(); // session cookie is set — reload boots the app as this user
      }

      if (label === 'Verify and sign in') {
        ev.stopPropagation(); ev.preventDefault();
        if (!pendingToken) return showAuthError('Start again from the sign-in screen.');
        var code = textInputs().map(function (i) { return String(i.value || '').trim(); }).join('');
        if (code.length < 6) return showAuthError('Enter the 6-digit code from your authenticator app.');
        var v = xhrDetailed('POST', '/v1/auth/verify-2fa', { pendingToken: pendingToken, code: code });
        if (!v.ok) return showAuthError(v.message);
        return location.reload();
      }
    }, true);
  }

  // Session present: the design still boots on its presentational sign-in screen, so step
  // past it — the engine has already vouched for this person via the session cookie.
  // Writing to a controlled React input requires the native setter plus an input event;
  // assigning .value alone is reverted on the next render.
  function setControlledValue(el, val) {
    try {
      var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      (d && d.set ? d.set : function (v) { this.value = v; }).call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { el.value = val; }
  }
  function skipPresentationalSignIn() {
    var tries = 0;
    var t = setInterval(function () {
      if (++tries > 120) return clearInterval(t);
      // innerText, not textContent: every screen lives in the DOM at once and only the
      // active one is visible, so textContent reports hidden cards as if they were on
      // screen. innerText is briefly empty mid-transition — skip those ticks rather than
      // acting on them.
      var body = (document.body && document.body.innerText) || '';
      if (!body.trim()) return;
      if (/Dashboard/i.test(body)) return clearInterval(t);
      if (/Two-step verification/i.test(body)) {
        // The engine already issued the session cookie; this screen is presentation only.
        // Where the engine DOES require a factor, login returns requires2fa and the gate
        // above collects the real code — this path is never reached in that case.
        var otp = [].slice.call(document.querySelectorAll('input[maxlength="6"]')).filter(function (i) { return i.offsetParent !== null; })[0];
        if (otp && String(otp.value || '').length < 6) return setControlledValue(otp, '000000');
        var v = findButton('Verify and sign in'); if (v) v.click();
        return;
      }
      if (/Welcome back/i.test(body)) {
        // 1.11 gates the button on both fields being filled — empty reads "Enter your email
        // and password". The engine has already vouched for this person via the session
        // cookie and the credential gate is NOT installed on this path, so filling the form
        // to get past a presentational screen attempts no login and proves nothing.
        var ins = textInputs(), em = null, pwd = null;
        for (var k = 0; k < ins.length; k++) {
          var ty = (ins[k].type || 'text').toLowerCase();
          if (ty === 'password' && !pwd) pwd = ins[k];
          else if (!em && ty !== 'password') em = ins[k];
        }
        if (em && !String(em.value || '').trim()) return setControlledValue(em, (window.__weweSignedInEmail || 'signed-in@wewe.org'));
        if (pwd && !String(pwd.value || '').trim()) return setControlledValue(pwd, 'session-already-established');
        var c = findButton('Continue'); if (c) c.click();
      }
    }, 120);
  }

  // Sign out must end the real session, not just the design's local state.
  function installSignOut() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn || btn.textContent.trim() !== 'Sign out') return;
      ev.stopPropagation(); ev.preventDefault();
      xhr('POST', '/v1/auth/logout');
      location.href = location.pathname;
    }, true);
  }

  var me = xhr('GET', '/v1/auth/me');
  if (!me || !me.user) {
    // Not signed in. Load nothing — the engine would refuse it anyway — and bridge the form.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSignInGate);
    else installSignInGate();
    return;
  }
  window.__weweUser = me.user && me.user.name;
  window.__weweSignedInEmail = me.user && me.user.email;
  installSignOut();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', skipPresentationalSignIn);
  else skipPresentationalSignIn();

  function naira(kobo) { try { return Number(BigInt(kobo || '0') / 100n); } catch (e) { return 0; } }
  function ddmmyyyy(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  function whenText(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return 'Today · ' + hm;
    return ddmmyyyy(iso) + ' · ' + hm;
  }
  function agoText(iso) {
    var h = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 3600000));
    return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }
  function title(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1).toLowerCase(); }
  var ROLE_LABEL = { SUPERVISOR: 'Supervisor', INTERNAL_AUDIT: 'Internal Audit', FINANCE: 'Finance', FINAL_APPROVER: 'Final Approver', HR_OFFICER: 'HR' };

  var data = {};
  function wire(key, fn) { try { var v = fn(); if (v && (!Array.isArray(v) || v.length)) data[key] = v; } catch (e) { /* fixture fallback */ } }

  // ---- transactions (requisitions register) ----
  wire('TXNS', function () {
    var reqs = xhr('GET', '/v1/requisitions?scope=all');
    if (!Array.isArray(reqs)) return null;
    return reqs.map(function (t) {
      var aging = '—';
      if (t.status === 'PENDING') aging = agoText(t.updatedAt) + ' at ' + (ROLE_LABEL[t.stageRole] || t.stageRole || '—');
      else if (t.status === 'APPROVED') aging = 'Closed ' + ddmmyyyy(t.updatedAt);
      else if (t.status === 'RETURNED') aging = 'Returned ' + agoText(t.updatedAt) + ' ago';
      else if (t.status === 'REJECTED') aging = 'Rejected ' + ddmmyyyy(t.updatedAt);
      return {
        ref: t.ref, title: t.title, who: t.initiator, dept: t.department,
        donor: t.donorCode || 'Core', amount: naira(t.amountKobo),
        stage: t.status === 'APPROVED' ? 5 : (Number(t.currentStage || 0) + 1),
        status: String(t.status || '').toLowerCase(), aging: aging,
        date: ddmmyyyy(t.submittedAt || t.updatedAt),
      };
    });
  });

  // ---- budgets ----
  wire('BUDGET_ROWS', function () {
    var pos = xhr('GET', '/v1/budgets/position');
    if (!Array.isArray(pos)) return null;
    return pos.map(function (b) {
      return {
        line: b.name || b.code, dept: (b.department && b.department.name) || '',
        donor: b.donorCode || 'Core',
        alloc: naira(b.allocatedKobo || b.allocated), comm: naira(b.committedKobo || b.committed),
        actual: naira(b.actualKobo || b.actual),
      };
    });
  });

  // ---- quickbooks exceptions ----
  wire('QB_EXCEPTIONS', function () {
    var qb = xhr('GET', '/v1/qb/outbox?status=ERROR');
    var rows = Array.isArray(qb) ? qb : (qb && (qb.rows || qb.items));
    if (!rows) return null;
    return rows.map(function (e) {
      return { ref: (e.payload && e.payload.ref) || e.txId || e.id, posted: whenText(e.createdAt), err: e.error || 'Sync error', amount: naira(e.payload && e.payload.amountKobo) };
    });
  });

  // ---- audit trail ----
  wire('AUDIT_LOG', function () {
    var rows = xhr('GET', '/v1/audit?limit=40');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (a) {
      return {
        when: whenText(a.createdAt),
        who: a.actorEmail ? a.actorEmail.split('@')[0].split('.').map(title).join(' ') : 'System',
        ev: String(a.action || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); }),
        obj: a.entityId, ip: a.ip || '—',
      };
    });
  });

  // ---- grants ----
  wire('GRANTS', function () {
    var rows = xhr('GET', '/v1/grants');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (g) {
      var fx = parseFloat(g.fxRateToNgn || '1') || 1;
      var valueNgn = g.currency === 'NGN' ? Number(BigInt(g.valueMinor || '0') / 100n) : Math.round(Number(BigInt(g.valueMinor || '0')) / 100 * fx);
      var spent = 0;
      var d = xhr('GET', '/v1/grants/' + g.id);
      if (d) {
        var t = d.totals || d;
        var actual = t.actualKobo || t.actualNgnKobo || (d.byLine && d.byLine.reduce ? null : null);
        if (actual) spent = naira(actual);
        else if (Array.isArray(d.byDepartment)) spent = d.byDepartment.reduce(function (s, x) { return s + naira(x.actualKobo || 0); }, 0);
      }
      return {
        code: g.code, donor: g.donor, title: g.title, value: valueNgn, spent: spent,
        from: ddmmyyyy(g.startDate), to: ddmmyyyy(g.endDate), state: title(g.status),
      };
    });
  });

  // ---- staff directory ----
  wire('STAFF', function () {
    var rows = xhr('GET', '/v1/staff');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (u, i) {
      return {
        name: u.name, role: u.title || '—', dept: (u.department && u.department.name) || u.departmentName || '—',
        id: 'WW-' + String(i + 1).padStart(4, '0'), phone: '—',
        status: u.active === false ? 'Inactive' : 'Active', leave: '—',
      };
    });
  });

  // ---- vendors ----
  wire('VENDORS', function () {
    var rows = xhr('GET', '/v1/vendors');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (v) {
      return {
        name: v.name, cat: (Array.isArray(v.categories) && v.categories[0]) || '—',
        spend: naira(v.totalSpendKobo || '0'),
        docs: v.dueDiligenceStatus || (v.dueDiligence ? 'Complete' : 'Documents pending'),
        state: v.blacklisted ? 'Blacklisted' : 'Approved',
        since: v.createdAt ? String(new Date(v.createdAt).getFullYear()) : '—',
      };
    });
  });

  // ---- assets ----
  wire('ASSETS', function () {
    var rows = xhr('GET', '/v1/assets');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (a) {
      var stateMap = { IN_SERVICE: 'In use', IN_STORE: 'In store', UNDER_REPAIR: 'Under repair', DISPOSED: 'Disposed', MISSING: 'Missing' };
      return {
        tag: a.tag, item: a.description, custodian: a.custodianName || (a.custodian && a.custodian.name) || '—',
        dept: '—', funder: a.fundingCode || 'Core', cost: naira(a.costKobo),
        nbv: naira(a.nbvKobo || a.costKobo), state: stateMap[a.status] || title(a.status),
      };
    });
  });

  // ---- inventory ----
  wire('INV_ITEMS', function () {
    var rows = xhr('GET', '/v1/inventory/items');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (it) {
      return {
        code: it.code, name: it.name, cat: '—', qty: it.qtyOnHand, unit: 0,
        reorder: it.reorderLevel, max: '—', store: 'Main store', updated: '—',
      };
    });
  });

  // ---- audit findings ----
  wire('FINDINGS', function () {
    var rows = xhr('GET', '/v1/findings');
    if (!Array.isArray(rows)) return null;
    var stateMap = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };
    return rows.map(function (f) {
      return {
        id: f.ref, title: f.title, sev: title(f.severity),
        owner: f.ownerName || (f.owner && f.owner.name) || '—',
        due: ddmmyyyy(f.dueDate), state: stateMap[f.status] || title(f.status),
      };
    });
  });

  // ---- leave ----
  wire('LEAVE', function () {
    var rows = xhr('GET', '/v1/leave/requests?scope=all') || xhr('GET', '/v1/leave/requests');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (l) {
      return {
        who: l.userName || (l.user && l.user.name) || '—',
        type: l.leaveTypeName || (l.leaveType && l.leaveType.name) || 'Leave',
        from: ddmmyyyy(l.startDate), to: ddmmyyyy(l.endDate), days: l.days,
        bal: '—', state: String(l.status || l.txStatus || 'pending').toLowerCase(), note: l.handoverNote || '',
      };
    });
  });

  // ---- admin users ----
  wire('USERS', function () {
    var rows = xhr('GET', '/v1/admin/users');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (u) {
      var pretty = function (c) {
        var code = String(c && c.code ? c.code : c);
        return ROLE_LABEL[code] || code.split('_').map(title).join(' ');
      };
      var roles = Array.isArray(u.roles) ? u.roles.map(pretty).join(', ') : '—';
      return {
        name: u.name, email: u.email, roles: roles,
        dept: (u.department && u.department.name) || u.departmentName || '—',
        tfa: Boolean(u.totpEnabledAt || u.tfa),
        last: u.lastSignIn ? whenText(u.lastSignIn) : '—',
      };
    });
  });

  window.__weweData = data;
})();

/* ---- Phase C: live queue page + Approve write-bridge ---- */
(function () {
  function xhr(method, url, body) {
    try {
      var r = new XMLHttpRequest();
      r.open(method, url, false); r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
      if (r.status < 200 || r.status >= 300) return null;
      return JSON.parse(r.responseText);
    } catch (e) { return null; }
  }
  function fmtNaira(kobo) {
    var k = BigInt(kobo || '0'); var whole = (k / 100n).toString(); var cents = (k % 100n).toString().padStart(2, '0');
    return '₦' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + cents;
  }
  function ageHours(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 3600000); }
  function waiting(iso) { var h = ageHours(iso); return Math.floor(h / 24) + 'd ' + (h % 24) + 'h'; }
  function slaBadge(iso) {
    var h = ageHours(iso);
    if (h >= 24) return 'r:OVERDUE ' + Math.max(1, Math.floor((h - 24) / 24) + 1) + 'D';
    if (h >= 18) return 'a:DUE SOON';
    return 'n:ON TIME';
  }

  var queue = xhr('GET', '/v1/requisitions?scope=queue');
  window.__weweRefMap = {};
  var all = xhr('GET', '/v1/requisitions?scope=all') || [];
  all.forEach(function (t) { window.__weweRefMap[t.ref] = t.id; });

  if (Array.isArray(queue)) {
    queue.forEach(function (t) { window.__weweRefMap[t.ref] = t.id; });
    var totalKobo = queue.reduce(function (s, t) { return s + BigInt(t.amountKobo || '0'); }, 0n);
    var overdue = queue.filter(function (t) { return ageHours(t.updatedAt) >= 24; });
    var oldest = queue.slice().sort(function (a, b) { return new Date(a.updatedAt) - new Date(b.updatedAt); })[0];
    window.__wewePageSpecs = {
      '/requisitions/queue': {
        title: 'Awaiting my approval',
        sub: queue.length + ' item' + (queue.length === 1 ? '' : 's') + ' in your queue worth ' + fmtNaira(totalKobo.toString()) +
          (oldest ? ' · oldest has waited ' + waiting(oldest.updatedAt) : ''),
        actions: ['Bulk approve', 'Export queue'],
        stats: [
          ['In my queue', String(queue.length), fmtNaira(totalKobo.toString()) + ' total value'],
          ['Overdue at my stage', String(overdue.length), overdue.slice(0, 2).map(function (t) { return t.ref; }).join(' and ') || 'Nothing overdue'],
          ['Live data', 'ON', 'Rows from the workflow engine'],
          ['Signed in as', (window.__weweUser || ''), 'Change with ?as=persona'],
        ],
        table: {
          title: 'Queue, oldest first',
          cols: [['Reference', null, '104px'], ['Item', null, 'minmax(130px,1fr)'], ['Amount', 'r', '116px'], ['Waiting', 'r', '84px'], ['SLA', null, '112px'], ['', null, '188px']],
          rows: queue.slice().sort(function (a, b) { return new Date(a.updatedAt) - new Date(b.updatedAt); })
            .map(function (t) {
              return [t.ref, t.title, fmtNaira(t.amountKobo), waiting(t.updatedAt), slaBadge(t.updatedAt), 'x:Approve|Return|Open'];
            }),
        },
      },
    };
  }

  // The row-level Approve write-bridge that used to live here is gone. Phase 1.9's decision
  // panel routes Approve through the same drawer as Return and Reject, so this bridge only
  // stole the click, skipped the confirmation step, and then reloaded the page. Removing it
  // makes all three verbs behave alike and drops the adapter's last location.reload().

  // Patch a register row IN PLACE after the engine moves it. The design builds REQ_ROWS with an
  // identity map (`TXNS.map(t => t)`), so the row OBJECTS are shared between the two arrays —
  // mutating one is seen by the register without rebuilding anything.
  var ROLE_NEXT = { SUPERVISOR: 1, INTERNAL_AUDIT: 2, FINANCE: 3, FINAL_APPROVER: 4 };
  window.__wewePatchTxnRow = function (ref, status, stageRole) {
    try {
      var rows = (window.__weweData && window.__weweData.TXNS) || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].ref !== ref) continue;
        var s = String(status || '').toLowerCase();
        rows[i].status = s;
        if (s === 'approved') { rows[i].stage = 5; rows[i].aging = 'Closed today'; }
        else if (s === 'rejected') rows[i].aging = 'Rejected today';
        else if (s === 'returned') rows[i].aging = 'Returned just now';
        else if (s === 'pending' && ROLE_NEXT[stageRole]) { rows[i].stage = ROLE_NEXT[stageRole] + 1; rows[i].aging = 'On time'; }
        return true;
      }
    } catch (e) { /* display-only */ }
    return false;
  };

  // T-02: bulk approve. Phase 1.8 routes confirmBulk through hook('BulkApprove', {ids, verb}),
  // so the DOM-interception bridge this used to need is gone — we answer the hook directly.
  // `ids` are REFS (the design's selection is keyed by ref), so map them through __weweRefMap.
  // Returning a string makes the design toast the REAL count; returning false makes it say so.
  window.__weweBulkApprove = function (p) {
    var refs = (p && p.ids) || [];
    var live = refs.filter(function (r) { return window.__weweRefMap && window.__weweRefMap[r]; });
    if (!live.length) return false;
    var res = xhr('POST', '/v1/requisitions/bulk-action', {
      ids: live.map(function (r) { return window.__weweRefMap[r]; }),
      verb: (p && p.verb) || 'approve',
    });
    if (!res || !res.succeeded) return false;
    (res.results || []).forEach(function (r) { if (r.ok) window.__wewePatchTxnRow(r.ref, r.status); });
    var n = res.succeeded;
    return n === res.requested
      ? n + (n === 1 ? ' item approved.' : ' items approved in one action.')
      : n + ' of ' + res.requested + ' approved — ' + (res.requested - n) + ' could not be, and are unchanged.';
  };
})();

/* ---- Phase D: live dashboards (active persona), grant totals, outstanding advances page ---- */
(function () {
  function xhr(method, url, body) {
    try {
      var r = new XMLHttpRequest();
      r.open(method, url, false); r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
      if (r.status < 200 || r.status >= 300) return null;
      return JSON.parse(r.responseText);
    } catch (e) { return null; }
  }
  function fmtNaira(kobo) {
    var k = BigInt(kobo || '0'); var neg = k < 0n; if (neg) k = -k;
    var whole = (k / 100n).toString(); var cents = (k % 100n).toString().padStart(2, '0');
    return (neg ? '-' : '') + '₦' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + cents;
  }
  function sumKobo(rows, f) { return rows.reduce(function (s, r) { return s + BigInt(f(r) || '0'); }, 0n); }
  function ageDays(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
  function ddmmyyyy(iso) { if (!iso) return '—'; var d = new Date(iso); return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); }

  var persona = new URLSearchParams(location.search).get('as') || 'admin';

  var queue = xhr('GET', '/v1/requisitions?scope=queue') || [];
  var dash = xhr('GET', '/v1/dashboard') || { pipeline: {}, myOpen: 0, queueCount: 0 };
  var qTotal = fmtNaira(sumKobo(queue, function (t) { return t.amountKobo; }).toString());
  var overdue = queue.filter(function (t) { return (Date.now() - new Date(t.updatedAt)) > 86400000; });
  var refs = queue.map(function (t) { return t.ref; });

  // grants + burn meters (also fixes the GRANTS spent mapping from Phase B)
  var grants = xhr('GET', '/v1/grants') || [];
  var meters = [];
  var committedTotalNgn = 0n;
  grants.forEach(function (g) {
    var d = xhr('GET', '/v1/grants/' + g.id);
    if (!d || !d.totals) return;
    var fx = parseFloat(g.fxRateToNgn || '1') || 1;
    var valueNgnKobo = g.currency === 'NGN' ? BigInt(g.valueMinor || '0')
      : BigInt(Math.round(Number(BigInt(g.valueMinor || '0')) * fx));
    committedTotalNgn += valueNgnKobo;
    var pct = d.health && typeof d.health.utilisationPct === 'number' ? Math.round(d.health.utilisationPct)
      : Math.round(Number(BigInt(d.totals.actualKobo || '0') * 100n) / Math.max(1, Number(valueNgnKobo)));
    meters.push({ label: g.code, pct: Math.min(100, pct), detail: fmtNaira(d.totals.actualKobo) + ' of ' + fmtNaira(valueNgnKobo.toString()) });
    // patch the GRANTS const data (Phase B wired it; totals key now known)
    if (window.__weweData && Array.isArray(window.__weweData.GRANTS)) {
      window.__weweData.GRANTS.forEach(function (row) {
        if (row.code === g.code) row.spent = Number(BigInt(d.totals.actualKobo || '0') / 100n);
      });
    }
  });

  // budgets meters (dept view for supervisor/initiator)
  var budgetMeters = [];
  var pos = xhr('GET', '/v1/budgets/position') || [];
  pos.slice(0, 4).forEach(function (b) {
    var alloc = BigInt(b.allocatedKobo || '1'); var actual = BigInt(b.actualKobo || '0');
    budgetMeters.push({
      label: b.code, pct: Math.min(100, Math.round(Number(actual * 100n) / Math.max(1, Number(alloc)))),
      detail: fmtNaira(actual.toString()) + ' of ' + fmtNaira(alloc.toString()),
    });
  });

  var qb = xhr('GET', '/v1/qb/outbox?status=ERROR') || [];
  var advAll = xhr('GET', '/v1/advances?scope=all') || [];
  var advOpen = advAll.filter(function (a) { return ['DISBURSED', 'RETIRING'].indexOf(a.status) >= 0; });
  var advTotal = fmtNaira(sumKobo(advOpen, function (a) { return a.balanceKobo; }).toString());

  var D = null;
  var base = {
    banner: '', queueTitle: 'Awaiting me', queueSubtitle: 'Live queue from the workflow engine',
    refs: refs, meterTitle: 'Grant burn rate', meterSubtitle: 'Actual against budget by donor', meters: meters.length ? meters : budgetMeters,
  };
  if (persona === 'finance') D = Object.assign({}, base, {
    title: 'Finance processing', soft: true,
    subtitle: queue.length + ' item' + (queue.length === 1 ? '' : 's') + ' for payment processing worth ' + qTotal + '.',
    cards: [
      { label: 'Awaiting Finance', value: String(queue.length), delta: '', context: qTotal + ' in value' },
      { label: 'Overdue at my stage', value: String(overdue.length), delta: '', context: overdue.slice(0, 2).map(function (t) { return t.ref; }).join(', ') || 'Nothing overdue' },
      { label: 'Advances outstanding', value: advTotal, delta: '', context: advOpen.length + ' open advance' + (advOpen.length === 1 ? '' : 's') },
      { label: 'QuickBooks exceptions', value: String(qb.length), delta: '', context: qb.length ? 'Needs review' : 'Sandbox mode · all posted' },
    ],
    banner: qb.length ? qb.length + ' posting' + (qb.length === 1 ? '' : 's') + ' failed to reach QuickBooks — see the exception queue.' : '',
    queueTitle: 'Awaiting Finance', queueSubtitle: 'Payment processing queue',
  });
  if (persona === 'supervisor') D = Object.assign({}, base, {
    title: 'Your department today', soft: true,
    subtitle: queue.length + ' request' + (queue.length === 1 ? '' : 's') + ' waiting for your review.',
    cards: [
      { label: 'Awaiting my review', value: String(queue.length), delta: '', context: qTotal + ' in value' },
      { label: 'Overdue at my stage', value: String(overdue.length), delta: '', context: overdue.length ? 'Act today' : 'Nothing overdue' },
      { label: 'In the pipeline', value: String(dash.pipeline.PENDING || 0), delta: '', context: 'Across all five stages' },
      { label: 'Returned for fixes', value: String(dash.pipeline.RETURNED || 0), delta: '', context: 'Awaiting resubmission' },
    ],
    queueTitle: 'Awaiting my review', queueSubtitle: 'Oldest first', meters: budgetMeters,
    meterTitle: 'Department budgets', meterSubtitle: 'Actual against allocation',
  });
  if (persona === 'initiator') D = Object.assign({}, base, {
    title: 'Your requests', soft: true,
    subtitle: dash.myOpen + ' of your items are open.',
    cards: [
      { label: 'My open items', value: String(dash.myOpen), delta: '', context: 'Drafts, pending and returned' },
      { label: 'Awaiting my action', value: String(dash.queueCount), delta: '', context: dash.queueCount ? 'Returned for your edits' : 'Nothing needs you' },
      { label: 'Approved this month', value: String(dash.pipeline.APPROVED || 0), delta: '', context: 'Across the organisation' },
      { label: 'In the pipeline', value: String(dash.pipeline.PENDING || 0), delta: '', context: 'Being reviewed now' },
    ],
    queueTitle: 'My submissions', queueSubtitle: 'Latest first', meters: budgetMeters,
    meterTitle: 'Department budgets', meterSubtitle: 'Actual against allocation',
  });
  if (persona === 'audit') D = Object.assign({}, base, {
    title: 'Compliance at a glance', soft: true,
    subtitle: queue.length + ' item' + (queue.length === 1 ? '' : 's') + ' at the Internal Audit stage.',
    cards: [
      { label: 'Awaiting Internal Audit', value: String(queue.length), delta: '', context: qTotal + ' in value' },
      { label: 'Open flags', value: String((xhr('GET', '/v1/audit-flags?status=OPEN') || []).length), delta: '', context: 'Raised by audit' },
      { label: 'Open findings', value: String((xhr('GET', '/v1/findings') || []).filter(function (f) { return f.status === 'OPEN'; }).length), delta: '', context: 'In the register' },
      { label: 'Overdue at my stage', value: String(overdue.length), delta: '', context: overdue.length ? 'Act today' : 'Nothing overdue' },
    ],
    queueTitle: 'Awaiting Internal Audit', queueSubtitle: 'Compliance review queue',
  });
  if (persona === 'md') {
    var approvedKobo = sumKobo((window.__weweData && window.__weweData.TXNS ? [] : []), function () { return '0'; });
    var pipe = xhr('GET', '/v1/analytics/pipeline');
    var med = pipe && pipe.stages && pipe.stages.length
      ? (pipe.stages.reduce(function (s, x) { return s + (x.medianHours || 0); }, 0) / 24).toFixed(1) + ' days' : '—';
    D = Object.assign({}, base, {
      title: 'The whole organisation, one screen', soft: true,
      subtitle: queue.length + ' decision' + (queue.length === 1 ? '' : 's') + ' for you.',
      cards: [
        { label: 'Awaiting my signature', value: String(queue.length), delta: '', context: qTotal + ' combined' },
        { label: 'In the pipeline', value: String(dash.pipeline.PENDING || 0), delta: '', context: 'Across all five stages' },
        { label: 'Grants active', value: String(grants.filter(function (g) { return g.status === 'ACTIVE'; }).length), delta: '', context: fmtNaira(committedTotalNgn.toString()) + ' committed' },
        { label: 'Cumulative approval path', value: med, delta: '', context: 'Sum of stage medians' },
      ],
      queueTitle: 'Awaiting my signature', queueSubtitle: 'Final release',
    });
  }
  if (D) { var o = {}; o[persona] = D; window.__weweDash = o; }

  // outstanding advances register page (finance/admin)
  if (advAll.length) {
    var overdueAdv = advOpen.filter(function (a) { return a.retirementDeadline && new Date(a.retirementDeadline) < new Date(); });
    window.__wewePageSpecs = window.__wewePageSpecs || {};
    window.__wewePageSpecs['/advances/outstanding'] = {
      title: 'Outstanding advances register',
      sub: 'Every advance not yet retired, aged against policy',
      actions: ['Export register', 'Send reminders'],
      stats: [
        ['Outstanding', advTotal, advOpen.length + ' open advance' + (advOpen.length === 1 ? '' : 's')],
        ['Overdue', String(overdueAdv.length), overdueAdv.length ? 'Past retirement deadline' : 'None past deadline'],
        ['Requested, not yet disbursed', String(advAll.filter(function (a) { return a.status === 'REQUESTED'; }).length), 'Awaiting Finance disbursement'],
        ['Live data', 'ON', 'Rows from the advances module'],
      ],
      table: {
        title: 'Register, oldest first',
        cols: [['Reference', null, '104px'], ['Staff', null, 'minmax(110px,1fr)'], ['Purpose', null, 'minmax(120px,1fr)'], ['Balance', 'r', '112px'], ['Deadline', null, '96px'], ['Age', 'r', '74px'], ['Status', null, '128px']],
        rows: advAll.map(function (a) {
          var isOver = a.retirementDeadline && new Date(a.retirementDeadline) < new Date();
          var badge = isOver ? 'r:OVERDUE' : a.status === 'REQUESTED' ? 'n:REQUESTED' : a.status === 'CLOSED' ? 'g:CLOSED' : 'a:' + a.status;
          return [a.ref || a.id, (a.staff && a.staff.name) || a.staffName || '—', a.purpose,
            fmtNaira(a.balanceKobo || a.amountKobo), ddmmyyyy(a.retirementDeadline), ageDays(a.createdAt || a.disbursedAt || Date.now()) + 'd', badge];
        }),
      },
    };
  }
})();

/* ---- Phase E: remaining persona dashboards (hr, procurement, admin, extaudit) ---- */
(function () {
  function xhr(u) {
    try {
      var r = new XMLHttpRequest(); r.open('GET', u, false); r.withCredentials = true; r.send(null);
      return r.status >= 200 && r.status < 300 ? JSON.parse(r.responseText) : null;
    } catch (e) { return null; }
  }
  var persona = new URLSearchParams(location.search).get('as') || 'admin';
  if (['hr', 'procurement', 'admin', 'extaudit'].indexOf(persona) === -1) return;
  var base = (window.__weweDash && window.__weweDash[persona]) || {};
  var card = function (label, value, context) { return { label: label, value: String(value), delta: '', context: context }; };
  var D = null;

  if (persona === 'hr') {
    var staff = xhr('/v1/staff') || [];
    var leave = xhr('/v1/leave/requests?scope=all') || [];
    var pendingLeave = leave.filter(function (l) { return String(l.status || l.txStatus || '').toUpperCase() !== 'APPROVED'; });
    var expiring = xhr('/v1/staff/expiring-contracts') || [];
    D = {
      title: 'People today', soft: true,
      subtitle: staff.length + ' staff on record · ' + pendingLeave.length + ' leave request' + (pendingLeave.length === 1 ? '' : 's') + ' in flight.',
      cards: [
        card('Staff on record', staff.length, 'Active directory'),
        card('Leave in flight', pendingLeave.length, 'Awaiting Supervisor or HR'),
        card('Contracts expiring', Array.isArray(expiring) ? expiring.length : 0, 'Within 60 days'),
        card('Live data', 'ON', 'From the HR module'),
      ],
      banner: '', queueTitle: 'Leave awaiting HR', queueSubtitle: 'Stage 2 of the leave chain',
      refs: [], meterTitle: 'Departments', meterSubtitle: 'Headcount share',
      meters: [],
    };
  }
  if (persona === 'procurement') {
    var vendors = xhr('/v1/vendors') || [];
    var rfqs = xhr('/v1/rfqs') || [];
    var pos = xhr('/v1/purchase-orders') || [];
    var contracts = xhr('/v1/contracts') || [];
    D = {
      title: 'Procurement pipeline', soft: true,
      subtitle: vendors.length + ' vendors on the registry.',
      cards: [
        card('Vendors', vendors.length, vendors.filter(function (v) { return v.blacklisted; }).length + ' blacklisted'),
        card('Open RFQs', (Array.isArray(rfqs) ? rfqs : []).filter(function (r) { return r.status === 'OPEN'; }).length, 'Awaiting quotes or selection'),
        card('Open POs', (Array.isArray(pos) ? pos : []).filter(function (p) { return p.status !== 'CLOSED'; }).length, 'Awaiting delivery'),
        card('Contracts', Array.isArray(contracts) ? contracts.length : 0, 'On the register'),
      ],
      banner: '', queueTitle: 'Latest vendors', queueSubtitle: 'Registry', refs: [],
      meterTitle: 'Grant burn rate', meterSubtitle: 'Actual against budget by donor', meters: (base.meters || []),
    };
  }
  if (persona === 'admin') {
    var users = xhr('/v1/admin/users') || [];
    var findings = xhr('/v1/findings') || [];
    var qb = xhr('/v1/qb/outbox?status=ERROR') || [];
    var chain = xhr('/v1/audit/verify') || { ok: false, checked: 0 };
    D = {
      title: 'System health', soft: true,
      subtitle: users.length + ' accounts · audit chain ' + (chain.ok ? 'verified (' + chain.checked + ' events)' : 'CHECK FAILED'),
      cards: [
        card('User accounts', users.length, users.filter(function (u) { return u.active === false; }).length + ' deactivated'),
        card('Audit chain', chain.ok ? 'OK' : 'FAIL', chain.checked + ' events verified'),
        card('Open findings', (Array.isArray(findings) ? findings : []).filter(function (f) { return f.status === 'OPEN'; }).length, 'In the register'),
        card('QuickBooks exceptions', Array.isArray(qb) ? qb.length : 0, qb.length ? 'Needs review' : 'Sandbox · all posted'),
      ],
      banner: chain.ok ? '' : 'Audit chain verification failed — investigate immediately.',
      queueTitle: 'Recent audit events', queueSubtitle: 'Immutable log', refs: [],
      meterTitle: 'Grant burn rate', meterSubtitle: 'Actual against budget by donor', meters: (base.meters || []),
    };
  }
  if (persona === 'extaudit') {
    var scope = xhr('/v1/auditor/my-scope');
    var reqs = xhr('/v1/requisitions?scope=all') || [];
    D = {
      title: 'Auditor workspace', soft: true,
      subtitle: scope ? 'Scope: ' + (scope.donorCode || 'all donors') + ' · access expires ' + new Date(scope.expiresAt).toLocaleDateString('en-GB') : 'No active scope.',
      cards: [
        card('Transactions in scope', reqs.length, scope && scope.donorCode ? scope.donorCode : 'All donors'),
        card('Access', 'READ-ONLY', 'Enforced at the API'),
        card('Scope expires', scope ? new Date(scope.expiresAt).toLocaleDateString('en-GB') : '—', 'Auto-revokes'),
        card('Every view logged', 'ON', 'Audit trail records access'),
      ],
      banner: '', queueTitle: 'In-scope transactions', queueSubtitle: 'Read-only',
      refs: reqs.slice(0, 6).map(function (t) { return t.ref; }),
      meterTitle: 'Scope', meterSubtitle: '', meters: [],
    };
  }
  if (D) {
    window.__weweDash = window.__weweDash || {};
    window.__weweDash[persona] = D;
  }
})();

/* ---- Phase F: Phase-2 bundle wiring — detail data, writes, notifications, account ---- */
(function () {
  function xhr(method, url, body) {
    try {
      var r = new XMLHttpRequest(); r.open(method, url, false); r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
      return r.status >= 200 && r.status < 300 ? JSON.parse(r.responseText) : null;
    } catch (e) { return null; }
  }
  function fmtWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return (d.toDateString() === now.toDateString() ? 'Today' :
      String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()) + ' · ' + hm;
  }
  var data = window.__weweData = window.__weweData || {};

  // G20: TXN_DETAIL for live requisition refs (others synthesise from TXNS per the manifest)
  try {
    var all = xhr('GET', '/v1/requisitions?scope=all') || [];
    var detail = {};
    all.slice(0, 20).forEach(function (t) {
      var d = xhr('GET', '/v1/requisitions/' + t.id);
      if (!d) return;
      var firstLine = (d.lines || [])[0];
      detail[d.ref] = {
        // Phase 1.9's decision panel renders from `d.permissions` and only falls back to guessing
        // from the design's local persona when it is missing — which is why Withdraw and Resubmit
        // never appeared. The engine already computes these per viewer; pass them straight through.
        permissions: d.permissions || undefined,
        budgetLine: (firstLine && firstLine.budgetLine && firstLine.budgetLine.name) || '—',
        allocated: 0, committed: 0,
        lines: (d.lines || []).map(function (l) { return [l.description, l.qty, Number(l.unitKobo)]; }),
        docs: [],
        comments: (d.history || []).filter(function (h) { return h.comment; }).map(function (h) {
          var tone = h.action === 'APPROVED' ? 'green' : (h.action === 'RETURNED' || h.action === 'REJECTED') ? 'amber' : 'neutral';
          return [h.actor, h.comment, fmtWhen(h.at), tone];
        }),
      };
    });
    if (Object.keys(detail).length) data.TXN_DETAIL = detail;
  } catch (e) { /* fixtures */ }

  // G5: notification centre
  try {
    var n = xhr('GET', '/v1/notifications');
    var rows = [];
    (n && n.needsAction || []).forEach(function (x) { rows.push({ id: x.id, kind: 'action', title: x.title, body: x.body || '', when: fmtWhen(x.createdAt), unread: !x.readAt, to: '/requisitions' }); });
    (n && n.updates || []).forEach(function (x) { rows.push({ id: x.id, kind: 'update', title: x.title, body: x.body || '', when: fmtWhen(x.createdAt), unread: !x.readAt, to: '/requisitions' }); });
    if (rows.length) data.NOTIFICATIONS = rows;
  } catch (e) { /* fixtures */ }

  // G6: my sessions · G9: my delegations
  try {
    var ses = xhr('GET', '/v1/auth/sessions');
    if (Array.isArray(ses) && ses.length) data.SESSIONS_MINE = ses.map(function (s) {
      return { device: 'Web session', where: '—', ip: s.ip, last: fmtWhen(s.createdAt), current: s.current };
    });
  } catch (e) { /* fixtures */ }
  try {
    var dels = xhr('GET', '/v1/delegations');
    if (Array.isArray(dels) && dels.length) data.DELEGATIONS_MINE = dels.map(function (d) {
      var active = d.active && new Date(d.endsAt) > new Date();
      return { to: d.delegateId, title: '', from: fmtWhen(d.startsAt), until: fmtWhen(d.endsAt), scope: 'All duties', state: active ? 'Active' : 'Ended', used: 0 };
    });
  } catch (e) { /* fixtures */ }

  // G11: bulk-approve eligibility from the real queue + real exclusion rules
  try {
    var q = xhr('GET', '/v1/requisitions?scope=queue') || [];
    var flags = xhr('GET', '/v1/audit-flags?status=OPEN') || [];
    var flagged = {};
    (Array.isArray(flags) ? flags : []).forEach(function (f) { if (f.entityType === 'transaction') flagged[f.entityId] = true; });
    var CAP = 100000000; // ₦1m default bulk cap (settings 'bulk.maxItemKobo')
    if (q.length) data.BULK_QUEUE = q.map(function (t) {
      var over = Number(t.amountKobo) > CAP, fl = flagged[t.ref];
      return {
        ref: t.ref, title: t.title, amount: Number(BigInt(t.amountKobo) / 100n),
        ok: !over && !fl,
        reason: fl ? 'Open audit flag — resolve before acting' : over ? 'Above the bulk-approve cap — approve individually' : '',
      };
    });
  } catch (e) { /* fixtures */ }

  // G10: chain editor from live workflow config (admin persona; fixture otherwise)
  try {
    var types = xhr('GET', '/v1/admin/transaction-types');
    if (Array.isArray(types) && types.length) {
      var ct = {};
      types.forEach(function (t) {
        ct[t.code] = (t.stages || []).map(function (st) {
          return { role: st.role, min: st.minAmountKobo ? Number(BigInt(st.minAmountKobo) / 100n) : 0, sla: st.slaHours || 24, note: '' };
        });
      });
      data.CHAIN_TYPES = ct;
    }
  } catch (e) { /* fixtures */ }

  // G21: the decision drawer's write hook — the design calls this on confirm
  window.__weweAct = function (ref, verb, note) {
    var id = window.__weweRefMap && window.__weweRefMap[ref];
    if (!id) { console.warn('[wewe] __weweAct: fixture ref, no engine call:', ref); return false; }
    // Synchronous on purpose: the design toasts and re-renders the instant this returns, so the
    // row has to be patched by then. It also lets the old location.reload() go — sign-in is
    // client-side design state with no persistence, so reloading dumped the approver back on the
    // login screen after every single approve, return or reject.
    // Phase 1.8 added Withdraw and Resubmit to the decision panel and routes them through this
    // same hook. They are NOT verbs on /action — the engine exposes them as their own endpoints
    // (/action takes approve|reject|return only), so send each to the right place.
    var res = (verb === 'withdraw' || verb === 'resubmit')
      ? xhr('POST', '/v1/transactions/' + id + '/' + verb, note ? { comment: note } : {})
      : xhr('POST', '/v1/transactions/' + id + '/action', { verb: verb, comment: note || undefined });
    if (!res) { console.warn('[wewe] ' + verb + ' ' + ref + ' was refused by the engine — nothing was written'); return false; }
    if (window.__wewePatchTxnRow) window.__wewePatchTxnRow(ref, res.status, res.currentStageRole);
    console.info('[wewe] ' + verb + ' ' + ref + ' →', res.status);
    return true;
  };
})();

/* ---- Phase G: extended live-read wiring ----
 * payroll, timesheets, procurement (RFQ vendors + quote comparison), documents/e-sign,
 * admin permission matrix + change log, retirement lines. Self-contained helpers so it
 * runs independently of Phase B's closure; writes into the shared window.__weweData so
 * the vite WIRED wraps (const X = (window.__weweData && window.__weweData.X) || [ … ])
 * pick these up at design boot. Each wire() no-ops to the design fixture on any failure. */
(function () {
  var data = window.__weweData = window.__weweData || {};
  function xhr(method, url, body) {
    try {
      var r = new XMLHttpRequest();
      r.open(method, url, false); r.withCredentials = true;
      if (body) r.setRequestHeader('content-type', 'application/json');
      r.send(body ? JSON.stringify(body) : null);
      if (r.status < 200 || r.status >= 300) return null;
      return JSON.parse(r.responseText);
    } catch (e) { return null; }
  }
  function naira(kobo) { try { return Number(BigInt(kobo || '0') / 100n); } catch (e) { return 0; } }
  function ddmmyyyy(iso) { if (!iso) return '—'; var d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
  function whenText(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return 'Today · ' + hm;
    return ddmmyyyy(iso) + ' · ' + hm;
  }
  function title(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1).toLowerCase(); }
  var ROLE_LABEL = { SUPERVISOR: 'Supervisor', INTERNAL_AUDIT: 'Internal Audit', FINANCE: 'Finance', FINAL_APPROVER: 'Final Approver', HR_OFFICER: 'HR' };
  var me = xhr('GET', '/v1/auth/me') || {};
  function wire(key, fn) { try { var v = fn(); if (v && (!Array.isArray(v) || v.length)) data[key] = v; } catch (e) { /* fixture fallback */ } }

  // ---- payroll: newest run's payslip rows ----
  wire('PAYROLL', function () {
    var runs = xhr('GET', '/v1/payroll/runs');
    if (!Array.isArray(runs) || !runs.length) return null;
    var run = xhr('GET', '/v1/payroll/runs/' + runs[0].id);
    if (!run || !Array.isArray(run.items) || !run.items.length) return null;
    return run.items.map(function (i) {
      return { name: i.user, gross: naira(i.grossKobo), tax: naira(i.payeKobo), pension: naira(i.pensionEmployeeKobo), net: naira(i.netKobo), var: '+₦0.00' };
    });
  });

  // ---- timesheets: my current sheet's project rows ----
  wire('TIMESHEET', function () {
    var sheets = xhr('GET', '/v1/timesheets?scope=mine');
    if (!Array.isArray(sheets) || !sheets.length) return null;
    var ts = sheets[0]; var rows = ts && ts.rows;
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows.map(function (r) {
      return { proj: r.projectCode, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, pct: r.percent };
    });
  });

  // ---- procurement: vendor shortlist for the RFQ builder — [name, note, defaultSelected, blocked] ----
  wire('RFQ_VENDORS', function () {
    var rows = xhr('GET', '/v1/vendors');
    if (!Array.isArray(rows)) return null;
    return rows.map(function (v) {
      var cat = (Array.isArray(v.categories) && v.categories[0]) || 'General supplies';
      var dd = v.dueDiligenceStatus; // 'COMPLETE' | 'EXPIRED' | 'INCOMPLETE'
      var ddText = dd === 'COMPLETE'
        ? ('due diligence valid' + (v.dueDiligence && v.dueDiligence.expiresAt
            ? ' to ' + new Date(v.dueDiligence.expiresAt).getFullYear() : ''))
        : dd === 'EXPIRED' ? 'due diligence lapsed' : 'due diligence documents pending';
      var blocked = Boolean(v.blacklisted) || dd !== 'COMPLETE';
      // NOTE: design's "· N awards ·" segment has NO API source — omitted, not invented.
      return [v.name, cat + ' · ' + ddText, !blocked, blocked];
    });
  });

  // ---- procurement: quote comparison sheet — { vendor, unit, total, delivery, warranty, score, chosen } ----
  wire('QUOTES', function () {
    var rfqs = xhr('GET', '/v1/rfqs');
    if (!Array.isArray(rfqs) || !rfqs.length) return null;
    var pick = rfqs.filter(function (r) { return (r.quoteCount || 0) > 0; })
      .sort(function (a, b) {
        var aw = a.status === 'SELECTED' ? 1 : 0, bw = b.status === 'SELECTED' ? 1 : 0;
        return (bw - aw) || ((b.quoteCount || 0) - (a.quoteCount || 0));
      })[0];
    if (!pick) return null;
    var cmp = xhr('GET', '/v1/rfqs/' + pick.id + '/comparison');
    if (!cmp || !Array.isArray(cmp.quotes) || !cmp.quotes.length) return null;
    return cmp.quotes.map(function (q) {
      var line0 = Array.isArray(q.lines) && q.lines[0];
      return {
        vendor: q.vendor && q.vendor.name,
        unit: line0 ? naira(line0.unitKobo) : naira(q.totalKobo),
        total: naira(q.totalKobo),
        chosen: Boolean(q.selected),
        delivery: '—',   // NO API field
        warranty: '—',   // NO API field
        score: null,     // NO scoring field in the API
      };
    });
  });

  // ---- Phase 1.11: RFQ rounds, keyed by the reference the buyer sees ----
  // The award screen reads RFQ_ROUNDS[ref] and picks a winner out of its quotes, so the quote
  // ids here have to be the engine's real ones — they are what comes back on the award.
  wire('RFQ_ROUNDS', function () {
    var rfqs = xhr('GET', '/v1/rfqs');
    if (!Array.isArray(rfqs) || !rfqs.length) return null;
    var out = {};
    rfqs.slice(0, 20).forEach(function (r) {
      var d = xhr('GET', '/v1/rfqs/' + r.id);
      if (!d) return;
      var quotes = (d.quotes || []).map(function (q) {
        return {
          id: q.id,
          vendor: (q.vendor && q.vendor.name) || '—',
          total: naira(q.totalKobo),
          days: q.deliveryDays || 0,
          valid: q.validityDays || 0,
          blacklisted: Boolean(q.vendor && q.vendor.blacklisted),
          note: q.note || '',
        };
      });
      out[r.ref] = {
        title: d.title || r.title,
        req: (d.requisition && d.requisition.ref) || '—',
        band: '—',                       // the band label is engine policy, not an RFQ field
        minQuotes: d.minQuotes || 3,     // the engine refuses below this without a sole-source case
        closed: ddmmyyyy(d.deadline),
        state: String(d.status || '').toLowerCase() === 'selected' ? 'awarded'
          : quotes.length ? 'evaluating' : 'open',
        quotes: quotes,
      };
    });
    return Object.keys(out).length ? out : null;
  });

  // ---- Phase 1.11: purchase orders, keyed by reference, with the lines a receipt counts ----
  wire('PO_RECORDS', function () {
    var pos = xhr('GET', '/v1/purchase-orders');
    if (!Array.isArray(pos) || !pos.length) return null;
    var out = {};
    pos.slice(0, 20).forEach(function (p) {
      var d = xhr('GET', '/v1/purchase-orders/' + p.id);
      if (!d) return;
      out[p.ref] = {
        vendor: (d.vendor && d.vendor.name) || '—',
        vendorTin: (d.vendor && d.vendor.tin) || '—',
        vendorAddr: (d.vendor && d.vendor.contact && d.vendor.contact.address) || '—',
        req: (d.requisition && d.requisition.ref) || '—',
        rfq: (d.rfq && d.rfq.ref) || '—',
        donor: d.donorCode || 'Core',
        budgetLine: (d.budgetLine && d.budgetLine.name) || '—',
        raised: ddmmyyyy(d.issuedAt || d.createdAt),
        promised: ddmmyyyy(d.promisedAt),
        terms: d.paymentTerms || '—',
        status: String(d.status || 'open').toLowerCase(),
        // [description, ordered, unit naira, already received] — the receipt form counts against these
        lines: (d.lines || []).map(function (l) {
          return [l.description, l.qty, naira(l.unitKobo), Number(l.receivedQty || 0)];
        }),
      };
    });
    return Object.keys(out).length ? out : null;
  });

  // ---- documents: library rows walked from the folder tree ----
  wire('DOCS', function () {
    function fmtBytes(n) {
      n = Number(n) || 0;
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      if (n >= 1024) return Math.round(n / 1024) + ' KB';
      return n + ' B';
    }
    var tree = xhr('GET', '/v1/dms/folders');
    if (!Array.isArray(tree)) return null;
    var folders = [];
    (function walk(nodes, prefix, ancConf) {
      nodes.forEach(function (n) {
        var path = prefix ? prefix + ' / ' + n.name : n.name;
        var conf = ancConf || !!n.confidential;
        folders.push({ id: n.id, path: path, conf: conf });
        if (Array.isArray(n.children)) walk(n.children, path, conf);
      });
    })(tree, '', false);
    var nameById = {};
    var people = xhr('GET', '/v1/admin/users') || xhr('GET', '/v1/staff') || [];
    (Array.isArray(people) ? people : []).forEach(function (u) { if (u.id) nameById[u.id] = u.name; });
    var out = [];
    folders.forEach(function (f) {
      var docs = xhr('GET', '/v1/dms/folders/' + f.id + '/documents');
      if (!Array.isArray(docs)) return;
      docs.forEach(function (d) {
        if (d.name === '[DISPOSED]') return;
        out.push({
          name: d.name, folder: f.path, size: fmtBytes(d.sizeBytes),
          ver: 'v' + d.currentVersion, by: nameById[d.uploadedById] || '—',
          when: ddmmyyyy(d.createdAt), conf: !!d.confidential || f.conf,
        });
      });
    });
    return out;
  });

  // ---- e-sign: in-progress ceremony signer panel ----
  wire('SIGNERS', function () {
    var reqs = xhr('GET', '/v1/esign/requests');
    if (!Array.isArray(reqs) || !reqs.length) return null;
    var r = reqs.filter(function (x) { return x.status === 'OPEN'; })[0] || reqs[0];
    if (!r || !Array.isArray(r.signers)) return null;
    var titleByName = {};
    var people = xhr('GET', '/v1/admin/users') || xhr('GET', '/v1/staff') || [];
    (Array.isArray(people) ? people : []).forEach(function (u) { if (u.name) titleByName[u.name] = u.title; });
    return r.signers.map(function (s) {
      var signed = s.status === 'SIGNED';
      return {
        name: s.name,
        role: s.internal ? (titleByName[s.name] || 'Internal signer') : 'External signer',
        state: signed ? 'signed' : 'pending',
        when: signed ? whenText(s.signedAt) : 'Invited ' + ddmmyyyy(r.createdAt),
      };
    });
  });

  // ---- e-sign: completed certificate signers ----
  wire('CERT_SIGNERS', function () {
    var reqs = xhr('GET', '/v1/esign/requests');
    if (!Array.isArray(reqs)) return null;
    var done = reqs.filter(function (x) { return x.status === 'COMPLETED' && x.certificate; });
    if (!done.length) return null;
    var cert = done[0].certificate;
    var methodMap = { drawn: 'Drawn', typed: 'Typed', saved: 'Saved signature' };
    var titleByName = {};
    var people = xhr('GET', '/v1/admin/users') || xhr('GET', '/v1/staff') || [];
    (Array.isArray(people) ? people : []).forEach(function (u) { if (u.name) titleByName[u.name] = u.title; });
    return (cert.signers || []).map(function (s) {
      var external = s.verification === 'email-otp';
      return {
        name: s.name,
        role: titleByName[s.name] || (external ? 'External signer' : 'Internal signer'),
        method: methodMap[s.method] || title(s.method),
        verified: external ? 'Email one-time code' : 'Password + authenticator',
        when: whenText(s.signedAt),
        ip: s.ip || '—',
        done: true,
      };
    });
  });

  // ---- admin: this user's resolved permission matrix ----
  wire('RESOLVED', function () {
    var uid = me.user && me.user.id;
    if (!uid) return null;
    var res = xhr('GET', '/v1/admin/permissions/resolve/' + uid);
    if (!res || !Array.isArray(res.permissions)) return null;
    var SCOPE = { own: 'Own', department: 'Department', organisation: 'Organisation' };
    var prettyRole = function (code) { return ROLE_LABEL[code] || String(code).split('_').map(title).join(' '); };
    return res.permissions.map(function (p) {
      return {
        perm: title(p.module) + ' · ' + title(p.action),
        scope: SCOPE[p.scope] || p.scope,
        via: (Array.isArray(p.via) ? p.via.map(prettyRole).join(', ') : '') + ' (system role)',
        note: '',
      };
    });
  });

  // ---- admin: permission change log (diff before/after grant sets) ----
  wire('PERM_CHANGES', function () {
    var rows = xhr('GET', '/v1/admin/permissions/changes');
    if (!Array.isArray(rows) || !rows.length) return null;
    var SCOPE = { own: 'Own', department: 'Department', organisation: 'Organisation' };
    var keyOf = function (g) { return g.module + ':' + g.action; };
    var out = [];
    rows.forEach(function (r) {
      var who = r.actorEmail ? r.actorEmail.split('@')[0].split('.').map(title).join(' ') : 'System';
      var when = whenText(r.createdAt);
      var before = {}, after = {};
      ((r.data && r.data.before) || []).forEach(function (g) { before[keyOf(g)] = g.scope; });
      ((r.data && r.data.after) || []).forEach(function (g) { after[keyOf(g)] = g.scope; });
      Object.keys(after).forEach(function (k) {
        var m = k.split(':'), label = title(m[0]) + ' · ' + title(m[1]);
        if (!(k in before)) out.push({ who: who, when: when, what: label, from: 'Off', to: 'On', state: 'published' });
        else if (before[k] !== after[k]) out.push({ who: who, when: when, what: label + ' · scope',
          from: SCOPE[before[k]] || before[k], to: SCOPE[after[k]] || after[k], state: 'published' });
      });
      Object.keys(before).forEach(function (k) {
        if (!(k in after)) { var m = k.split(':');
          out.push({ who: who, when: when, what: title(m[0]) + ' · ' + title(m[1]), from: 'On', to: 'Off', state: 'published' }); }
      });
    });
    return out.length ? out : null;
  });

  // ---- retirements: first live retirement's expense lines (budget=actual, no variance source) ----
  wire('RET_LINES', function () {
    var rets = xhr('GET', '/v1/retirements?scope=all') || [];
    for (var i = 0; i < rets.length; i++) {
      var d = xhr('GET', '/v1/retirements/' + rets[i].id);
      var lines = (d && d.lines) || [];
      if (!lines.length) continue;
      return lines.map(function (l) {
        var actual = naira(l.amountKobo);
        return { desc: l.description, budget: actual, actual: actual, receipt: l.receiptRef || '—' };
      });
    }
    return null;
  });
})();

/* ---- Phase G: live procurement register pages (PO + contracts) ---- */
(function () {
  function xhr(u) { try { var r = new XMLHttpRequest(); r.open('GET', u, false); r.withCredentials = true; r.send(null); return r.status >= 200 && r.status < 300 ? JSON.parse(r.responseText) : null; } catch (e) { return null; } }
  function fmtNaira(kobo) { var k = BigInt(kobo || '0'); var w = (k / 100n).toString(); var c = (k % 100n).toString().padStart(2, '0'); return '₦' + w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + c; }
  function ddmmyyyy(iso) { if (!iso) return '—'; var d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
  window.__wewePageSpecs = window.__wewePageSpecs || {};

  // --- /procurement/orders ---
  var pos = xhr('/v1/purchase-orders');
  if (Array.isArray(pos) && pos.length) {
    var BADGE = { CLOSED: 'g:CLOSED', PARTIAL: 'a:PART DELIVERED', OPEN: 'n:OPEN', CANCELLED: 'r:CANCELLED' };
    var open = pos.filter(function (p) { return p.status !== 'CLOSED' && p.status !== 'CANCELLED'; });
    var openTotal = open.reduce(function (s, p) { return s + BigInt(p.totalKobo || '0'); }, 0n);
    window.__wewePageSpecs['/procurement/orders'] = {
      title: 'Purchase orders',
      sub: fmtNaira(openTotal.toString()) + ' committed across ' + open.length + ' open order' + (open.length === 1 ? '' : 's') + ' · partial deliveries tracked per line',
      actions: ['Export PO register'],
      stats: [
        ['Open orders', String(open.length), fmtNaira(openTotal.toString())],
        ['Closed', String(pos.filter(function (p) { return p.status === 'CLOSED'; }).length), 'Delivered in full'],
        ['Partial deliveries', String(pos.filter(function (p) { return p.status === 'PARTIAL'; }).length), 'Awaiting balance'],
        ['Live data', 'ON', 'Rows from the procurement module'],
      ],
      table: {
        title: 'Purchase orders',
        cols: [['PO number', null, '130px'], ['Vendor', null, 'minmax(160px,1fr)'], ['Description', null, 'minmax(160px,1fr)'], ['Value', 'r', '140px'], ['Received', 'r', '110px'], ['Status', null, '140px']],
        rows: pos.map(function (p) {
          var lines = Array.isArray(p.lines) ? p.lines : [];
          var ordered = lines.reduce(function (s, l) { return s + Number(l.qty || 0); }, 0);
          var got = lines.reduce(function (s, l) { return s + Number(l.receivedQty || 0); }, 0);
          var pct = ordered ? Math.round(got / ordered * 100) : 0;
          return [p.ref, p.vendorName || '—', (lines[0] && lines[0].description) || p.ref, fmtNaira(p.totalKobo), pct + '%', BADGE[p.status] || ('n:' + p.status)];
        }),
      },
    };
  }

  // --- /procurement/contracts ---
  var cons = xhr('/v1/contracts');
  if (Array.isArray(cons) && cons.length) {
    var now = Date.now(), soon = 60 * 86400000;
    var active = cons.filter(function (c) { return c.status === 'ACTIVE'; });
    var valTotal = active.reduce(function (s, c) { return s + BigInt(c.valueKobo || '0'); }, 0n);
    var paidTotal = active.reduce(function (s, c) { return s + BigInt(c.paidKobo || '0'); }, 0n);
    var expiring = active.filter(function (c) { return c.endDate && (new Date(c.endDate).getTime() - now) <= soon; });
    window.__wewePageSpecs['/procurement/contracts'] = {
      title: 'Contracts',
      sub: 'Payments are metered against contract value · expiry alerts fire 60 days out',
      actions: ['New contract'],
      stats: [
        ['Active contracts', String(active.length), fmtNaira(valTotal.toString()) + ' value'],
        ['Expiring in 60 days', String(expiring.length), expiring.length ? (expiring[0].vendorName || '') : 'None'],
        ['Drawn to date', fmtNaira(paidTotal.toString()), valTotal > 0n ? Math.round(Number(paidTotal * 100n) / Number(valTotal)) + '% of value' : ''],
        ['Live data', 'ON', 'Rows from the procurement module'],
      ],
      table: {
        title: 'Contract register',
        cols: [['Reference', null, '130px'], ['Vendor / scope', null, 'minmax(180px,1fr)'], ['Value', 'r', '150px'], ['Paid to date', 'r', '150px'], ['Drawn', 'r', '90px'], ['Expires', null, '130px']],
        rows: cons.map(function (c) {
          var val = BigInt(c.valueKobo || '0'), paid = BigInt(c.paidKobo || '0');
          var pct = val > 0n ? Math.round(Number(paid * 100n) / Number(val)) : 0;
          var end = c.endDate ? new Date(c.endDate).getTime() : null;
          var badge = (c.status === 'EXPIRED' || (end && end <= now)) ? 'r:' + ddmmyyyy(c.endDate)
            : (end && (end - now) <= soon) ? 'a:' + ddmmyyyy(c.endDate)
            : 'n:' + (c.endDate ? ddmmyyyy(c.endDate) : '—');
          return [c.ref, (c.vendorName || '—') + ' — ' + c.title, fmtNaira(c.valueKobo), fmtNaira(c.paidKobo), pct + '%', badge];
        }),
      },
    };
  }
})();

/* ---- Phase G: live virement register (/budgets/virements) ---- */
(function () {
  function xhr(u) { try { var r = new XMLHttpRequest(); r.open('GET', u, false); r.withCredentials = true; r.send(null); return r.status >= 200 && r.status < 300 ? JSON.parse(r.responseText) : null; } catch (e) { return null; } }
  function fmtNaira(kobo) { var k = BigInt(kobo || '0'); var neg = k < 0n; if (neg) k = -k; var w = (k / 100n).toString(); var c = (k % 100n).toString().padStart(2, '0'); return (neg ? '-' : '') + '₦' + w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + c; }
  function sumKobo(rows, f) { return rows.reduce(function (s, r) { return s + BigInt(f(r) || '0'); }, 0n); }
  function ddmmyyyy(iso) { if (!iso) return '—'; var d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

  var vs = xhr('/v1/virements');
  if (Array.isArray(vs) && vs.length) {
    var fromName = function (v) { return v.fromLineName || v.fromLine || (v.fromBudgetLine && v.fromBudgetLine.name) || '—'; };
    var toName = function (v) { return v.toLineName || v.toLine || (v.toBudgetLine && v.toBudgetLine.name) || '—'; };
    var STATE = { PENDING: 'a:AT FINANCE', AT_FINANCE: 'a:AT FINANCE', AT_MD: 'a:AT MD', APPROVED: 'g:APPROVED', DECLINED: 'r:DECLINED', REJECTED: 'r:DECLINED' };
    var open = vs.filter(function (v) { return ['APPROVED', 'DECLINED', 'REJECTED'].indexOf(v.status) === -1; });
    var openTotal = sumKobo(open, function (v) { return v.amountKobo; });
    var approved = vs.filter(function (v) { return v.status === 'APPROVED'; });
    var declined = vs.filter(function (v) { return v.status === 'DECLINED' || v.status === 'REJECTED'; });
    window.__wewePageSpecs = window.__wewePageSpecs || {};
    window.__wewePageSpecs['/budgets/virements'] = {
      title: 'Virement requests',
      sub: 'Moving budget between lines requires Finance and Final Approver sign-off',
      actions: ['New virement'],
      stats: [
        ['Open requests', String(open.length), fmtNaira(openTotal.toString()) + ' in movement'],
        ['Approved', String(approved.length), fmtNaira(sumKobo(approved, function (v) { return v.amountKobo; }).toString())],
        ['Declined', String(declined.length), declined.length ? 'See register' : 'None'],
        ['Live data', 'ON', 'Rows from the budgets module'],
      ],
      table: {
        title: 'Virement register',
        cols: [['Reference', null, '120px'], ['From line', null, 'minmax(160px,1fr)'], ['To line', null, 'minmax(160px,1fr)'], ['Amount', 'r', '140px'], ['Raised', null, '110px'], ['Status', null, '140px']],
        rows: vs.map(function (v) {
          return [v.ref || v.id, fromName(v), toName(v), fmtNaira(v.amountKobo), ddmmyyyy(v.createdAt), STATE[v.status] || ('n:' + (v.status || '—'))];
        }),
      },
    };
  }
})();

/* ---- Phase H: write-hook bridge ----
 * The Phase 2.4 design calls window['__wewe'+Name](payload) SYNCHRONOUSLY at each submit
 * point and shows the returned string as a toast; a THROW shows "nothing was saved.".
 * We define handlers for the hooks whose real API DTO can be satisfied from the payload the
 * design passes (verified against the NestJS/Zod routes). Every write is synchronous so the
 * toast reflects the REAL server result; on non-2xx the helper throws the server's message,
 * so a failed write is shown honestly and nothing is faked.
 *
 * Wired: CreateRequisition, SaveRequisitionDraft, SubmitPayroll, SubmitTimesheet, ApplyLegalHold.
 * Intentionally NOT wired (design payload lacks a required field / the endpoint doesn't exist):
 *   SettleRefund (no retirement id), EmailPayslip + RaiseRemittancePayment (no such route),
 *   CreateStaff/StartOnboarding/CreateObjective (no ids; objectives has no backend),
 *   SendRfq (needs title), StartAssetVerification (needs location), CreateDonor (needs code/donor/…),
 *   UploadDocuments (no file bytes), CreateEvidencePack (endpoint bundles txns, not docs),
 *   SignDocument (no esign request id), SaveWorkflowChain/CreateRole/PublishRole/SaveForm/
 *   PublishForm/SaveReport (thin payloads / no forms endpoint), SignOutOtherSessions/SaveSignature/
 *   Enrol2fa/StartDelegation/CancelDelegation (no self-serve route / no TOTP code / no ids).
 * Those keep the design's honest "Submitted."/"Saved." fallback until the design enriches the
 * payloads (loose-end A1 follow-up) or the missing endpoints are added. */
(function () {
  function req(method, url, body) {
    var r = new XMLHttpRequest();
    r.open(method, url, false); r.withCredentials = true;
    if (body !== undefined) r.setRequestHeader('content-type', 'application/json');
    r.send(body !== undefined ? JSON.stringify(body) : null);
    var parsed = null; try { parsed = JSON.parse(r.responseText); } catch (e) { /* non-JSON */ }
    if (r.status < 200 || r.status >= 300) {
      var m = parsed && (parsed.message || parsed.error);
      if (Array.isArray(m)) m = m.join('; ');
      if (parsed && Array.isArray(parsed.issues)) m = parsed.issues.map(function (i) { return i.message; }).join('; ');
      throw new Error(m || ('The server rejected it (HTTP ' + r.status + ')'));
    }
    return parsed;
  }
  function post(url, body) { return req('POST', url, body === undefined ? {} : body); }
  function put(url, body) { return req('PUT', url, body === undefined ? {} : body); }
  function patch(url, body) { return req('PATCH', url, body === undefined ? {} : body); }
  function get(url) { return req('GET', url); }

  // The design binds `const TXNS = window.__weweData.TXNS` ONCE at parse time, so it holds a
  // reference to that exact array. A write that only hits the server leaves the register showing
  // the page-load snapshot: the row the user just saved is missing until a full browser reload,
  // which reads as "it didn't save". Mutating the array IN PLACE (never reassigning it) is what
  // the design's own reference sees; the design's `go()` right after each hook re-renders and
  // picks the new row up. Reloading instead is not an option — auth is client-side design state,
  // so location.reload() would bounce the user back to the sign-in screen.
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ddmmyyyy(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function txnRow(res) {
    var amount = 0;
    try { amount = Number(BigInt(res.amountKobo || '0') / 100n); } catch (e) { amount = 0; }
    var status = String(res.status || '').toLowerCase();
    return {
      ref: res.ref, title: res.title,
      who: (res.initiator && res.initiator.name) || '',
      dept: (res.department && res.department.name) || '',
      donor: res.donorCode || 'Core',
      amount: amount,
      stage: status === 'approved' ? 5 : (Number(res.currentStage || 0) + 1),
      status: status,
      aging: status === 'draft' ? '—' : 'On time',
      date: ddmmyyyy(res.submittedAt || res.createdAt),
    };
  }
  // Mutating TXNS alone is not enough: the register renders from
  //   const REQ_ROWS = TXNS.map(t => t);            (design bundle, one site)
  // a copy taken once at design-parse time that lives in module scope, with no handle on window.
  // That one call is an IDENTITY map, so intercepting `map` on the TXNS array — which the adapter
  // publishes BEFORE the design parses — lets us keep a reference to each full-list copy and add
  // new rows to them later. A non-identity map (say `t => t.ref`) is passed through untracked.
  var TXN_CLONES = [];
  (function trackTxnClones() {
    var src = window.__weweData && window.__weweData.TXNS;
    if (!Array.isArray(src) || src.__weweTracked) return;
    try {
      Object.defineProperty(src, 'map', {
        enumerable: false, configurable: true, writable: true,
        value: function (fn, thisArg) {
          var out = Array.prototype.map.call(this, fn, thisArg);
          var identity = out.length === this.length;
          for (var i = 0; identity && i < out.length; i++) if (out[i] !== this[i]) identity = false;
          if (identity) TXN_CLONES.push(out);
          return out;
        },
      });
      Object.defineProperty(src, '__weweTracked', { value: true, enumerable: false });
    } catch (e) { /* non-fatal — the row simply won't show until the next page load */ }
  })();

  // Make a just-created transaction visible to the design without a reload.
  function registerNewTxn(res) {
    if (!res || !res.ref) return;
    try {
      window.__weweRefMap = window.__weweRefMap || {};
      window.__weweRefMap[res.ref] = res.id; // lets the Approve write-bridge act on the new row
      var row = txnRow(res);
      var d = window.__weweData;
      if (d && Array.isArray(d.TXNS) && d.TXNS.indexOf(row) === -1) d.TXNS.unshift(row);
      TXN_CLONES.forEach(function (arr) { if (arr.indexOf(row) === -1) arr.unshift(row); });
    } catch (e) { /* never let a display refresh break a write that already succeeded */ }
  }

  // ---- Requisitions: create + submit for approval ----
  window.__weweCreateRequisition = function (p) {
    var budgetLineId = null;
    if (p.budgetLine) {
      try {
        var positions = get('/v1/budgets/position');
        var match = (positions || []).find(function (b) { return b.name === p.budgetLine; });
        if (match) budgetLineId = match.budgetLineId;
      } catch (e) { budgetLineId = null; } // optional field — omit if the lookup is unavailable
    }
    var lines = p.lines.map(function (l) {
      var line = { description: l.desc, qty: l.qty, unitKobo: String(Math.round(l.unit * 100)) };
      if (budgetLineId) line.budgetLineId = budgetLineId;
      return line;
    });
    var body = { title: p.purpose, lines: lines, submit: true };
    // Phase 1.10: over budget with headroom makes the justification mandatory before submit.
    // Carry it through — the engine records it in the audit trail beside the budget warning,
    // and dropping it here would mean the initiator wrote it for nothing.
    if (p.overBudgetJustification) body.overBudgetJustification = p.overBudgetJustification;
    var res = post('/v1/requisitions', body);
    registerNewTxn(res);
    return 'Requisition ' + res.ref + ' submitted for approval.';
  };

  // ---- Requisitions: save draft (no submit) ----
  window.__weweSaveRequisitionDraft = function (p) {
    var lines = p.lines.map(function (l) {
      return { description: l.desc, qty: l.qty, unitKobo: String(Math.round(l.unit * 100)) };
    });
    var res = post('/v1/requisitions', { title: p.purpose, lines: lines });
    registerNewTxn(res);
    return 'Draft ' + res.ref + ' saved.';
  };

  // ---- Procurement (Phase 1.11) ----
  // The design addresses things the way a buyer does — a vendor by name, an RFQ or PO by its
  // printed reference — while the engine keys on ids. These resolvers close that gap; without
  // them every procurement write would 404 on an identifier that is perfectly correct on screen.
  function resolveVendorId(nameOrId) {
    var v = String(nameOrId || '').trim();
    if (!v) return null;
    var all = get('/v1/vendors') || [];
    var hit = all.find(function (x) { return x.id === v; })
      || all.find(function (x) { return String(x.name).toLowerCase() === v.toLowerCase(); })
      || all.find(function (x) { return String(x.name).toLowerCase().indexOf(v.toLowerCase()) === 0; });
    return hit ? hit.id : null;
  }
  function resolveRfqId(refOrId) {
    var v = String(refOrId || '').trim();
    if (!v) return null;
    var all = get('/v1/rfqs') || [];
    var hit = all.find(function (x) { return x.id === v || x.ref === v; });
    return hit ? hit.id : null;
  }
  function resolvePoId(refOrId) {
    var v = String(refOrId || '').trim();
    if (!v) return null;
    var all = get('/v1/purchase-orders') || [];
    var hit = all.find(function (x) { return x.id === v || x.ref === v; });
    return hit ? hit.id : null;
  }
  // Amounts arrive from the design in naira (its money fields are naira throughout); the
  // engine takes kobo as a string. Never let a float reach the wire.
  function nairaToKoboString(n) {
    var num = Number(n);
    if (!isFinite(num) || num < 0) return null;
    return String(Math.round(num * 100));
  }

  window.__weweCreateVendor = function (p) {
    var name = String((p && p.name) || '').trim();
    if (name.length < 2) return false;
    var body = { name: name };
    if (p.contact) {
      var c = {};
      if (p.contact.email) c.email = String(p.contact.email).trim();
      if (p.contact.phone) c.phone = String(p.contact.phone).trim();
      if (p.contact.address) c.address = String(p.contact.address).trim();
      if (Object.keys(c).length) body.contact = c;
    }
    if (p.tin) body.tin = String(p.tin).trim();
    if (Array.isArray(p.categories) && p.categories.length) body.categories = p.categories;
    var res = post('/v1/vendors', body);
    if (!res || !res.id) return false;
    return 'Vendor ' + res.name + ' registered.';
  };

  window.__weweRecordDueDiligence = function (p) {
    // The design passes the vendor by name here (its form field is the name).
    var id = resolveVendorId(p && p.vendorId);
    if (!id) return false;
    var res = patch('/v1/vendors/' + id, {
      dueDiligence: {
        cacDocId: String((p && p.cacDocId) || '').trim(),
        taxClearanceDocId: String((p && p.taxClearanceDocId) || '').trim(),
        expiresAt: (p && p.expiresAt) || undefined,
      },
    });
    if (!res) return false;
    return res.dueDiligenceStatus === 'COMPLETE'
      ? 'Due diligence recorded — this vendor can now be invited to quote.'
      : 'Due diligence saved, but it is still incomplete: both the CAC and tax clearance references are needed, with an expiry in the future.';
  };

  window.__weweAddQuote = function (p) {
    var rfqId = resolveRfqId(p && p.rfqId);
    var vendorId = resolveVendorId(p && p.vendorId);
    if (!rfqId || !vendorId) return false;
    var kobo = nairaToKoboString(p && p.totalKobo);   // named Kobo by the design, sent as naira
    if (!kobo) return false;
    var body = { vendorId: vendorId, totalKobo: kobo };
    if (p.validityDays) body.validityDays = Number(p.validityDays);
    var res = post('/v1/rfqs/' + rfqId + '/quotes', body);
    if (!res) return false;
    return 'Quote recorded.';
  };

  window.__weweAwardQuote = function (p) {
    var rfqId = resolveRfqId(p && p.rfqId);
    if (!rfqId) return false;
    // The design's quote ids are the ones we supplied in RFQ_ROUNDS, so they are already real.
    var body = { quoteId: String((p && p.quoteId) || ''), justification: String((p && p.justification) || '').trim() };
    if (p.soleSource) body.soleSource = String(p.soleSource).trim();
    if (p.committeeNote) body.committeeNote = String(p.committeeNote).trim();
    var res = post('/v1/rfqs/' + rfqId + '/select', body);
    if (!res) return false;
    return 'Quote awarded. You can now raise the purchase order.';
  };

  window.__weweCreatePurchaseOrder = function (p) {
    var rfqId = resolveRfqId(p && p.rfqId);
    if (!rfqId) return false;
    var res = post('/v1/purchase-orders', { rfqId: rfqId });
    if (!res || !res.ref) return false;
    return 'Purchase order ' + res.ref + ' raised.';
  };

  window.__weweRecordGoodsReceipt = function (p) {
    var poId = resolvePoId(p && p.purchaseOrderId);
    if (!poId) return false;
    var lines = (p && p.lines || []).filter(function (l) { return Number(l.qty) > 0; })
      .map(function (l) { return { lineIndex: Number(l.lineIndex), qty: Number(l.qty) }; });
    if (!lines.length) return false;
    var body = { lines: lines };
    if (p.note) body.note = String(p.note).trim();
    var res = post('/v1/purchase-orders/' + poId + '/receipts', body);
    if (!res) return false;
    return 'Goods receipt recorded.';
  };

  // Deliberately answered with a refusal rather than left undefined. An unwired hook falls
  // back to the design's own success copy, which would announce a payment that never happened;
  // returning false makes the design show its failure state instead. The payload carries only
  // a contract reference — no amount — so there is nothing to post. Recorded as gap 30.
  window.__weweRecordContractPayment = function () { return false; };
  // Same reasoning: the engine has no draft state for a purchase order (a PO is generated from
  // an awarded RFQ), so there is nothing to save. Recorded as gap 30.
  window.__weweSavePurchaseOrderDraft = function () { return false; };

  // ---- Procurement: raise a request for quotation ----
  // The only procurement write the design currently emits. Everything else in the module —
  // adding a quote, awarding a winning quote, raising the PO, receipting goods, vendors and
  // contracts — is fully built and tested on the engine but has no control in the bundle to
  // trigger it, so it cannot be wired from here. Recorded for Design as gap 29.
  window.__weweSendRfq = function (p) {
    var title = String((p && p.title) || '').trim();
    if (title.length < 3) return false; // the engine's own floor — fail before the round trip
    var res = post('/v1/rfqs', { title: title });
    if (!res || !res.ref) return false;
    return 'Request for quotation ' + res.ref + ' created.';
  };

  // ---- Payroll: compute the run, then release it for approval ----
  window.__weweSubmitPayroll = function (p) {
    var run = post('/v1/payroll/runs', { period: p.period });
    try {
      post('/v1/payroll/runs/' + run.id + '/release', {});
    } catch (e) {
      return 'Payroll for ' + p.period + ' was computed and saved as a draft, but sending it for approval failed: ' + e.message;
    }
    return 'Payroll for ' + p.period + ' sent for approval.';
  };

  // ---- Timesheets: apportion entered hours to whole-percent effort, submit ----
  window.__weweSubmitTimesheet = function (p) {
    var byCode = {}, order = [];
    (p.rows || []).forEach(function (r) {
      if (!r || !r.proj || !String(r.proj).trim() || !Array.isArray(r.d)) return;
      var hours = r.d.reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
      if (hours <= 0) return;
      var code = String(r.proj).split(' — ')[0].trim().slice(0, 40); // token before the em-dash
      if (!code) return;
      if (byCode[code] === undefined) { byCode[code] = 0; order.push(code); }
      byCode[code] += hours;
    });
    if (!order.length) throw new Error('Timesheet is empty — enter hours against at least one project before submitting.');
    if (order.length > 100) throw new Error('Too many projects to express as whole-percent effort — please consolidate.');
    var total = order.reduce(function (s, c) { return s + byCode[c]; }, 0);
    var base = 100 - order.length; // reserve a 1% floor per kept row
    var shares = order.map(function (c) { return byCode[c] / total * base; });
    var pct = shares.map(function (s) { return Math.floor(s); });
    var rem = base - pct.reduce(function (a, b) { return a + b; }, 0);
    order.map(function (c, i) { return { i: i, frac: shares[i] - pct[i] }; })
      .sort(function (a, b) { return b.frac - a.frac; })
      .slice(0, rem)
      .forEach(function (o) { pct[o.i]++; });
    var rows = order.map(function (c, i) { return { projectCode: c, percent: pct[i] + 1 }; });
    var now = new Date();
    var period = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
    var ts = post('/v1/timesheets', { period: period, rows: rows });
    try {
      post('/v1/timesheets/' + ts.id + '/submit', {});
    } catch (e) {
      return 'Timesheet for ' + period + ' was saved as a draft, but submitting it for approval failed: ' + e.message;
    }
    return 'Timesheet for ' + period + ' submitted for approval.';
  };

  // ---- Documents: apply a legal hold (resolve doc names → ids first, exact-match guarded) ----
  window.__weweApplyLegalHold = function (p) {
    var names = (p && p.documents) || [];
    if (!names.length) throw new Error('No documents selected');
    var ids = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var res = get('/v1/dms/search?q=' + encodeURIComponent(name));
      var hits = ((res && res.results) || []).filter(function (r) { return r.name === name; });
      if (hits.length !== 1) throw new Error('Could not uniquely identify "' + name + '" on the server');
      ids.push(hits[0].id);
    }
    for (var j = 0; j < ids.length; j++) {
      post('/v1/dms/documents/' + ids[j] + '/legal-hold', { on: true });
    }
    return 'Legal hold applied to ' + ids.length + (ids.length === 1 ? ' document.' : ' documents.');
  };
})();
