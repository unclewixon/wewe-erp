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
      var roles = Array.isArray(u.roles)
        ? u.roles.map(function (r) { return ROLE_LABEL[r.code || r] || title(r.code || r); }).join(', ')
        : '—';
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
