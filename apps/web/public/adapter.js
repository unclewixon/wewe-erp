/**
 * WEWE ERP data adapter (Phase B) — feeds LIVE API data into the verbatim design's
 * render paths. NOT a design file; the design bundle stays byte-identical (cmp guard).
 *
 * Persona bridge: open the app with ?as=<persona> to load data as that user —
 *   initiator | supervisor | audit | finance | md | hr | procurement | admin | extaudit
 * (defaults to admin). The design's own sign-in/persona switcher stays untouched;
 * changing the DATA persona = reload with a different ?as=.
 *
 * Synchronous XHR is deliberate: the design compiles its consts at boot, so data must
 * exist before support.js runs. Dev-bridge pattern; production moves to an async gate.
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

  var PERSONAS = {
    initiator: 'amina.yusuf@wewe.org', supervisor: 'tunde.balogun@wewe.org',
    audit: 'ngozi.okafor@wewe.org', finance: 'ibrahim.musa@wewe.org',
    md: 'folake.adeyemi@wewe.org', hr: 'blessing.adeyemi@wewe.org',
    procurement: 'emeka.nwosu@wewe.org', admin: 'admin@wewe.org',
    extaudit: 'k.adeleke@auditfirm.ng',
  };
  var wanted = new URLSearchParams(location.search).get('as');
  var email = PERSONAS[wanted] || PERSONAS.admin;

  var me = xhr('GET', '/v1/auth/me');
  if (!me || (me.user && me.user.email !== email)) {
    xhr('POST', '/v1/auth/logout');
    xhr('POST', '/v1/auth/login', { email: email, password: 'Password1!' });
    me = xhr('GET', '/v1/auth/me');
  }
  if (!me) return; // API down → design renders its fixtures
  window.__weweUser = me.user && me.user.name;

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

  // Write-bridge: an Approve button inside a row whose text carries a LIVE ref → real engine call.
  // Return/Reject stay design-side until the comment drawer is bound (design gap — a note is mandatory).
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!btn || btn.textContent.trim() !== 'Approve') return;
    var node = btn, ref = null;
    for (var up = 0; up < 6 && node; up++) {
      var m = (node.innerText || '').match(/\b((?:REQ|ADV|RET|VIR|PO|LVE|TSH|PAY)-\d{4}-\d{4})\b/);
      if (m) { ref = m[1]; break; }
      node = node.parentElement;
    }
    if (!ref || !window.__weweRefMap[ref]) return; // fixture row → leave to the design's own noop
    ev.stopPropagation(); ev.preventDefault();
    btn.disabled = true;
    fetch('/v1/requisitions/' + window.__weweRefMap[ref] + '/action', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verb: 'approve' }),
    }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (res.ok) { console.info('[wewe] approved', ref, '→', res.body.status); location.reload(); }
        else { console.warn('[wewe] approve blocked:', res.body.message); btn.disabled = false; }
      })
      .catch(function () { btn.disabled = false; });
  }, true);
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
    fetch('/v1/transactions/' + id + '/action', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verb: verb, comment: note || undefined }),
    }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (res.ok) { console.info('[wewe] ' + verb + ' ' + ref + ' →', res.body.status); location.reload(); }
        else console.warn('[wewe] ' + verb + ' blocked:', res.body.message);
      })
      .catch(function (e) { console.warn('[wewe] act failed', e); });
    return true;
  };
})();
