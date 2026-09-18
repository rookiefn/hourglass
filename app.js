/* Hourglass 主逻辑
   列表渲染 / 新建编辑删除 / 长按拖拽排序 / 分享链接 / 备份导入导出 */
(function () {
  'use strict';

  var HG = window.Hourglass;
  if (!HG) { console.error('Hourglass: store.js 没加载成功，页面无法工作'); return; }

  var $ = function (sel) { return document.querySelector(sel); };

  var listEl = $('#list');
  var emptyEl = $('#empty');
  var toastEl = $('#toast');
  var storageWarnEl = $('#storageWarn');

  var editSheet = $('#editSheet');
  var editTitleEl = $('#editTitle');
  var inpTitle = $('#inpTitle');
  var inpDate = $('#inpDate');
  var inpNote = $('#inpNote');
  var colorRowEl = $('#colorRow');
  var previewEl = $('#editPreview');
  var btnSave = $('#btnSave');
  var btnDelete = $('#btnDelete');
  var btnShare = $('#btnShare');
  var orderRowEl = $('#orderRow');
  var btnMoveUp = $('#btnMoveUp');
  var btnMoveDown = $('#btnMoveDown');

  var settingsSheet = $('#settingsSheet');
  var fileImportEl = $('#fileImport');
  var btnInstallEl = $('#btnInstall');
  var installTextEl = $('#installText');

  var shareViewEl = $('#shareView');
  var shareCardEl = $('#shareCard');

  var confirmEl = $('#confirm');
  var confirmTitleEl = $('#confirmTitle');
  var confirmMsgEl = $('#confirmMsg');
  var confirmOkEl = $('#confirmOk');
  var confirmCancelEl = $('#confirmCancel');

  /* 今天 / 未来 / 已过期：三组的显示顺序 */
  var GROUP_TODAY = 0, GROUP_FUTURE = 1, GROUP_EXPIRED = 2;

  var state = {
    editingId: null,
    draftColor: HG.COLORS[0],
    sharedItem: null
  };

  var suppressClick = false;   // 拖拽结束时压掉紧随其后的 click
  var lastToday = HG.todayISO();

  /* ================= 提示与确认 ================= */

  var toastTimer = 0;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  var confirmResolve = null;

  function askConfirm(opts) {
    confirmTitleEl.textContent = opts.title || '';
    confirmMsgEl.textContent = opts.message || '';
    confirmOkEl.textContent = opts.okText || '确定';
    confirmCancelEl.textContent = opts.cancelText || '取消';
    confirmOkEl.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
    confirmEl.classList.remove('hidden');
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }

  function resolveConfirm(answer) {
    confirmEl.classList.add('hidden');
    if (confirmResolve) { confirmResolve(answer); confirmResolve = null; }
  }

  /* ================= 列表渲染 ================= */

  function rowsWithDays() {
    return HG.list().map(function (it) {
      var days = HG.daysUntil(it.date);
      var group = (days === 0) ? GROUP_TODAY : (days < 0 ? GROUP_EXPIRED : GROUP_FUTURE);
      return { item: it, days: days, group: group };
    });
  }

  /* 显示顺序：今天置顶 → 未来按你的手动顺序 → 已过期按最近过期在前压在底部 */
  function orderedRows() {
    var rows = rowsWithDays();
    rows.sort(function (a, b) {
      if (a.group !== b.group) return a.group - b.group;
      if (a.group === GROUP_EXPIRED) return b.days - a.days;
      return 0;   // 组内保持用户拖出来的顺序（sort 在现代浏览器里是稳定的）
    });
    return rows;
  }

  function buildCardBody(row) {
    var it = row.item;
    var card = document.createElement('div');
    card.className = 'card'
      + (row.group === GROUP_TODAY ? ' today' : '')
      + (row.group === GROUP_EXPIRED ? ' expired' : '');
    card.style.setProperty('--accent', 'var(--c-' + it.color + ')');

    var bar = document.createElement('span');
    bar.className = 'bar';
    card.appendChild(bar);

    var info = document.createElement('div');
    info.className = 'info';

    var title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.title;
    info.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (it.note ? it.note + ' · ' : '') + HG.formatDate(it.date, true);
    info.appendChild(meta);

    card.appendChild(info);

    var num = document.createElement('div');
    num.className = 'num';
    if (row.group === GROUP_TODAY) {
      num.appendChild(labelSpan('就是今天'));
    } else if (row.group === GROUP_EXPIRED) {
      num.appendChild(labelSpan('已到期'));
    } else {
      var days = document.createElement('span');
      days.className = 'days';
      days.textContent = String(row.days);
      num.appendChild(days);
      var unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = '天';
      num.appendChild(unit);
    }
    card.appendChild(num);

    return card;
  }

  function labelSpan(text) {
    var s = document.createElement('span');
    s.className = 'label-text';
    s.textContent = text;
    return s;
  }

  function render() {
    var rows = orderedRows();
    listEl.innerHTML = '';

    if (!rows.length) {
      emptyEl.classList.remove('hidden');
      listEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');

    rows.forEach(function (row) {
      var card = buildCardBody(row);
      card.dataset.id = row.item.id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', row.item.title + '，' + describeDays(row.days));

      card.addEventListener('click', function () {
        if (suppressClick) { suppressClick = false; return; }
        openEdit(row.item.id);
      });
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(row.item.id); }
      });
      card.addEventListener('pointerdown', onMouseDown);
      card.addEventListener('touchstart', onTouchStart, { passive: true });
      card.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

      listEl.appendChild(card);
    });
  }

  function describeDays(days) {
    if (days === 0) return '就是今天';
    if (days < 0) return '已过期';
    return '还有 ' + days + ' 天';
  }

  /* ================= 长按拖拽排序 ================= */

  var drag = null;         // 正在拖拽
  var touchPress = null;   // 触摸长按判定中
  var PRESS_MS = 380;      // 按住多久算拖拽

  /* 鼠标走 pointer 事件 */
  function onMouseDown(ev) {
    if (ev.pointerType !== 'mouse') return;    // 触摸一律走下面那套，避免两套逻辑打架
    if (ev.button !== 0) return;
    if (ev.target.closest && ev.target.closest('button')) return;

    var card = ev.currentTarget;
    var startX = ev.clientX, startY = ev.clientY;
    var timer = setTimeout(function () { beginDrag(card, startY, 'mouse'); }, PRESS_MS);

    function onMove(e) {
      /* 鼠标先移动了 = 用户想选中文字，取消长按 */
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cleanup();
    }
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }

  /* 触摸走 touch 事件。
     手机上浏览器会在手指开始移动的那一刻判断「这串触摸是不是滚动手势」，
     判断依据是【第一次触摸之前，祖先链上有没有非 passive 的 touchmove 监听】。
     一旦判成滚动，手势就被系统收走，拖拽中途失效、卡片弹回原位。
     所以 onTouchMove 必须常驻注册（见 bindEvents），不能等长按成立才挂上去。 */
  function onTouchStart(ev) {
    if (drag || touchPress) return;
    if (ev.touches.length !== 1) return;               // 双指缩放不掺和
    if (ev.target.closest && ev.target.closest('button')) return;

    var t = ev.touches[0];
    var press = { card: ev.currentTarget, x: t.clientX, y: t.clientY, timer: 0 };
    press.timer = setTimeout(function () {
      touchPress = null;
      beginDrag(press.card, press.y, 'touch');
    }, PRESS_MS);
    touchPress = press;
  }

  function cancelTouchPress() {
    if (!touchPress) return;
    clearTimeout(touchPress.timer);
    touchPress = null;
  }

  function onTouchMove(ev) {
    if (drag) {
      if (ev.cancelable) ev.preventDefault();          // 拖拽期间不让页面跟着滚
      if (ev.touches.length) moveDrag(ev.touches[0].clientY);
      return;
    }
    if (!touchPress) return;
    var t = ev.touches[0];
    if (!t) return;
    /* 手指一开始就在滑动 = 用户想滚动列表，放弃这次长按 */
    if (Math.abs(t.clientX - touchPress.x) > 10 || Math.abs(t.clientY - touchPress.y) > 10) cancelTouchPress();
  }

  function onTouchEnd() {
    cancelTouchPress();
    if (drag) endDrag();
  }

  function beginDrag(card, startY, source) {
    var cards = Array.prototype.slice.call(listEl.querySelectorAll('.card'));
    var from = cards.indexOf(card);
    if (from < 0) return;

    /* 只在同一组内拖动：今天组在最上、已过期组在最下，不跨组 */
    var groups = orderedRows().map(function (r) { return r.group; });
    var g = groups[from], min = from, max = from;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i] === g) {
        if (i < min) min = i;
        if (i > max) max = i;
      }
    }
    if (max === min) return;

    var gap = parseFloat(getComputedStyle(listEl).rowGap) || 12;

    drag = {
      card: card,
      cards: cards,
      source: source,
      from: from,
      to: from,
      min: min,
      max: max,
      step: card.offsetHeight + gap,
      startY: startY,
      baseScroll: window.scrollY,
      speed: 0,
      raf: 0
    };

    card.classList.add('dragging');
    document.body.classList.add('is-dragging');

    /* 触摸的移动和结束由 touchmove / touchend 驱动，不挂 pointer 监听。
       这样浏览器中途发来的 pointercancel 就碰不到这次拖拽了。 */
    if (source === 'mouse') {
      window.addEventListener('pointermove', onDragMove, { passive: false });
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    }

    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    toast('拖动到想要的位置，松手保存');
  }

  /* 位置更新只认「手指/鼠标现在在哪个 y」，两种输入共用同一套 */
  function moveDrag(clientY) {
    if (!drag) return;

    var dy = (clientY - drag.startY) + (window.scrollY - drag.baseScroll);
    drag.card.style.transform = 'translateY(' + dy + 'px) scale(1.02)';

    var to = Math.round(dy / drag.step) + drag.from;
    if (to < drag.min) to = drag.min;
    if (to > drag.max) to = drag.max;
    if (to !== drag.to) { drag.to = to; layoutOthers(); }

    autoScroll(clientY);
  }

  function onDragMove(ev) {
    if (!drag) return;
    moveDrag(ev.clientY);
    if (ev.cancelable) ev.preventDefault();
  }

  function layoutOthers() {
    drag.cards.forEach(function (c, i) {
      if (i === drag.from) return;
      var shift = 0;
      if (i < drag.from && i >= drag.to) shift = drag.step;
      else if (i > drag.from && i <= drag.to) shift = -drag.step;
      c.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  /* 手指靠近屏幕上下边缘时自动滚屏，否则长列表拖不到远处 */
  function autoScroll(y) {
    var margin = 90;
    var vh = window.innerHeight;
    if (y < margin) drag.speed = -Math.max(2, Math.ceil((margin - y) / 6));
    else if (y > vh - margin) drag.speed = Math.max(2, Math.ceil((y - (vh - margin)) / 6));
    else drag.speed = 0;

    if (drag.speed !== 0 && !drag.raf) drag.raf = requestAnimationFrame(scrollTick);
  }

  function scrollTick() {
    if (!drag) return;
    if (!drag.speed) { drag.raf = 0; return; }
    window.scrollBy(0, drag.speed);
    drag.raf = requestAnimationFrame(scrollTick);
  }

  function endDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;

    if (d.source === 'mouse') {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    }
    if (d.raf) cancelAnimationFrame(d.raf);

    d.card.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    d.cards.forEach(function (c) { c.style.transform = ''; });

    /* 长按过就不要再被当成一次点击 */
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 400);

    if (d.to !== d.from) {
      var ids = d.cards.map(function (c) { return c.dataset.id; });
      var moved = ids.splice(d.from, 1)[0];
      ids.splice(d.to, 0, moved);
      if (!HG.setOrder(ids)) toast('顺序没能保存，请重试');
    }

    render();
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
  }

  /* ================= 新建 / 编辑 ================= */

  function plusDays(n) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d;
  }

  function openEdit(id) {
    state.editingId = id || null;

    var it = id ? HG.get(id) : null;
    if (id && !it) { toast('这条倒计时已经不在了'); render(); return; }

    editTitleEl.textContent = it ? '编辑倒计时' : '新建倒计时';
    inpTitle.value = it ? it.title : '';
    inpNote.value = it ? it.note : '';
    inpDate.value = it ? it.date : HG.todayISO(plusDays(7));
    setDraftColor(it ? it.color : HG.COLORS[HG.count() % HG.COLORS.length]);

    btnShare.classList.toggle('hidden', !it);
    btnDelete.classList.toggle('hidden', !it);
    updateOrderButtons();

    updatePreview();
    editSheet.classList.remove('hidden');

    if (!it) setTimeout(function () { try { inpTitle.focus(); } catch (e) {} }, 280);
  }

  function setDraftColor(color) {
    state.draftColor = color;
    renderColorRow();
    updatePreview();
  }

  function renderColorRow() {
    colorRowEl.innerHTML = '';
    HG.COLORS.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-dot' + (name === state.draftColor ? ' on' : '');
      b.style.setProperty('--dot', 'var(--c-' + name + ')');
      b.setAttribute('aria-label', '颜色 ' + name);
      b.addEventListener('click', function () { setDraftColor(name); });
      colorRowEl.appendChild(b);
    });
  }

  function updatePreview() {
    var date = inpDate.value;
    var days = HG.daysUntil(date);

    previewEl.innerHTML = '';
    var label = document.createElement('p');
    label.className = 'preview-label';
    label.textContent = '效果预览';
    previewEl.appendChild(label);

    if (days === null) {
      var bad = document.createElement('p');
      bad.className = 'preview-label';
      bad.textContent = '还没选日期';
      previewEl.appendChild(bad);
      return;
    }

    previewEl.appendChild(buildCardBody({
      item: {
        title: inpTitle.value.trim() || '未命名',
        date: date,
        note: inpNote.value.trim(),
        color: state.draftColor
      },
      days: days,
      group: (days === 0) ? GROUP_TODAY : (days < 0 ? GROUP_EXPIRED : GROUP_FUTURE)
    }));
  }

  function saveEdit() {
    var title = inpTitle.value.trim();
    var date = inpDate.value;

    if (!title) { toast('先给它起个名字'); inpTitle.focus(); return; }
    if (!HG.parseISO(date)) { toast('再选一个目标日期'); return; }

    var res = state.editingId
      ? HG.update(state.editingId, { title: title, date: date, note: inpNote.value.trim(), color: state.draftColor })
      : HG.add({ title: title, date: date, note: inpNote.value.trim(), color: state.draftColor });

    if (!res.ok) { toast(res.error); return; }

    editSheet.classList.add('hidden');
    render();
    toast(state.editingId ? '已保存' : '已添加');
    state.editingId = null;
  }

  function deleteEditing() {
    var it = state.editingId ? HG.get(state.editingId) : null;
    if (!it) return;

    askConfirm({
      title: '删除这条倒计时？',
      message: '「' + it.title + '」将被删除，删除后无法恢复。',
      okText: '删除',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      var res = HG.remove(it.id);
      if (!res.ok) { toast(res.error); return; }
      editSheet.classList.add('hidden');
      state.editingId = null;
      render();
      toast('已删除');
    });
  }

  /* ================= 排序的兜底方式（点按钮，不依赖手势） ================= */

  /* 找出某一条在「同组」里的位置区间：排序只在今天组/未来组/已过期组各自内部进行 */
  function groupBounds(id) {
    var rows = orderedRows();
    var at = -1;
    for (var i = 0; i < rows.length; i++) if (rows[i].item.id === id) at = i;
    if (at < 0) return null;

    var g = rows[at].group, min = at, max = at;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].group !== g) continue;
      if (j < min) min = j;
      if (j > max) max = j;
    }
    return { rows: rows, at: at, min: min, max: max };
  }

  function updateOrderButtons() {
    var b = state.editingId ? groupBounds(state.editingId) : null;
    if (!b || b.max === b.min) {
      orderRowEl.classList.add('hidden');
      return;
    }
    orderRowEl.classList.remove('hidden');
    btnMoveUp.disabled = (b.at <= b.min);
    btnMoveDown.disabled = (b.at >= b.max);
  }

  function nudge(dir) {
    if (!state.editingId) return;
    var b = groupBounds(state.editingId);
    if (!b) return;

    var target = b.at + dir;
    if (target < b.min || target > b.max) {
      toast(dir < 0 ? '已经在最上面了' : '已经在最下面了');
      return;
    }

    var ids = b.rows.map(function (r) { return r.item.id; });
    var swap = ids[b.at];
    ids[b.at] = ids[target];
    ids[target] = swap;

    if (!HG.setOrder(ids)) { toast('顺序没能保存，请重试'); return; }
    updateOrderButtons();
    render();
    toast(dir < 0 ? '已上移' : '已下移');
  }

  /* ================= 分享 ================= */

  function shareItem(it) {
    if (location.protocol === 'file:') {
      toast('先把页面放到网上，分享链接才能用');
      return;
    }

    var url = location.origin + location.pathname + '?s=' + HG.encodeShare(it);
    var days = HG.daysUntil(it.date);
    var text = it.title + '（' + HG.formatDate(it.date) + '）' + describeDays(days);

    if (navigator.share) {
      navigator.share({ title: 'Hourglass', text: text, url: url }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        copyText(url, '链接已复制，发给朋友即可');
      });
      return;
    }
    copyText(url, '链接已复制，发给朋友即可');
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () { toast(okMsg); },
        function () { legacyCopy(text, okMsg); }
      );
      return;
    }
    legacyCopy(text, okMsg);
  }

  function legacyCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    toast(ok ? okMsg : '复制失败，请手动复制地址栏链接');
  }

  function renderShareCard(data) {
    shareCardEl.innerHTML = '';
    shareCardEl.style.setProperty('--accent', 'var(--c-' + data.color + ')');

    var bar = document.createElement('span');
    bar.className = 'bar';
    shareCardEl.appendChild(bar);

    var title = document.createElement('h1');
    title.className = 'share-title';
    title.textContent = data.title;
    shareCardEl.appendChild(title);

    if (data.note) {
      var note = document.createElement('p');
      note.className = 'share-note';
      note.textContent = data.note;
      shareCardEl.appendChild(note);
    }

    var days = HG.daysUntil(data.date);
    var num = document.createElement('div');
    num.className = 'num';

    if (days === 0) {
      num.appendChild(labelSpan('就是今天'));
    } else if (days < 0) {
      num.appendChild(labelSpan('已到期'));
    } else {
      var d = document.createElement('span');
      d.className = 'days';
      d.textContent = String(days);
      num.appendChild(d);
      var unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = '天';
      num.appendChild(unit);
    }
    shareCardEl.appendChild(num);

    var date = document.createElement('p');
    date.className = 'share-date';
    date.textContent = HG.formatDate(data.date, true);
    shareCardEl.appendChild(date);
  }

  function openShareView(data) {
    state.sharedItem = data;
    renderShareCard(data);
    shareViewEl.classList.remove('hidden');
  }

  function closeShareView() {
    shareViewEl.classList.add('hidden');
    state.sharedItem = null;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 老浏览器忽略 */ }
    render();
  }

  /* 打开页面时如果链接里带着别人的倒计时，就直接展示 */
  function initShareView() {
    var code = new URLSearchParams(location.search).get('s');
    if (!code) return false;

    var data = HG.decodeShare(code);
    if (!data) { toast('这个分享链接不完整，可能被截断了'); return false; }

    openShareView(data);
    return true;
  }

  /* ================= 备份 ================= */

  function exportBackup() {
    var items = HG.list();
    if (!items.length) { toast('还没有数据可以导出'); return; }

    var payload = JSON.stringify(HG.exportPayload(), null, 2);
    var blob = new Blob([payload], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'hourglass-backup-' + HG.todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

    toast('已导出 ' + items.length + ' 条，文件在「下载 / 文件」里');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onerror = function () { toast('文件读不出来，换个文件试试'); };
    reader.onload = function () {
      var payload;
      try { payload = JSON.parse(String(reader.result)); }
      catch (e) { toast('这个文件不是 Hourglass 的备份'); return; }

      var res = HG.importPayload(payload);
      if (!res.ok) { toast(res.error); return; }

      render();
      var parts = [];
      if (res.added) parts.push('新增 ' + res.added + ' 条');
      if (res.updated) parts.push('更新 ' + res.updated + ' 条');
      if (res.skipped) parts.push('跳过 ' + res.skipped + ' 条');
      toast(parts.length ? '导入完成：' + parts.join('，') : '没有需要导入的内容');
    };
    reader.readAsText(file);
  }

  /* ================= 交互绑定 ================= */

  function bindEvents() {
    $('#btnAdd').addEventListener('click', function () { openEdit(null); });
    $('#btnEmptyAdd').addEventListener('click', function () { openEdit(null); });
    $('#btnSettings').addEventListener('click', function () { settingsSheet.classList.remove('hidden'); });

    /* 面板里的取消 / 完成 / 点空白关闭 */
    document.addEventListener('click', function (ev) {
      var trigger = ev.target.closest ? ev.target.closest('[data-close]') : null;
      if (!trigger) return;
      var wrap = trigger.closest('.sheet-wrap');
      if (!wrap) return;
      if (wrap === confirmEl) resolveConfirm(false);
      else wrap.classList.add('hidden');
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!confirmEl.classList.contains('hidden')) { resolveConfirm(false); return; }
      if (!editSheet.classList.contains('hidden')) { editSheet.classList.add('hidden'); return; }
      if (!settingsSheet.classList.contains('hidden')) { settingsSheet.classList.add('hidden'); }
    });

    /* 触摸拖拽的两个常驻监听。
       必须在这里（页面启动时）就注册成非 passive：
       等到长按成立再加就晚了，浏览器那时已经把这串触摸定为「滚动手势」。
       不拖拽时它们什么都不做，正常滚动不受影响。 */
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);

    /* 编辑表单 */
    btnMoveUp.addEventListener('click', function () { nudge(-1); });
    btnMoveDown.addEventListener('click', function () { nudge(1); });
    btnSave.addEventListener('click', saveEdit);
    btnDelete.addEventListener('click', deleteEditing);
    btnShare.addEventListener('click', function () {
      var it = state.editingId ? HG.get(state.editingId) : null;
      if (it) shareItem(it);
    });

    inpTitle.addEventListener('input', updatePreview);
    inpNote.addEventListener('input', updatePreview);
    inpDate.addEventListener('input', updatePreview);
    inpDate.addEventListener('change', updatePreview);

    Array.prototype.forEach.call(document.querySelectorAll('[data-quick]'), function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(btn.dataset.quick, 10);
        inpDate.value = HG.todayISO(plusDays(n));
        updatePreview();
      });
    });

    /* 设置 */
    $('#btnExport').addEventListener('click', exportBackup);
    $('#btnImport').addEventListener('click', function () { fileImportEl.click(); });
    fileImportEl.addEventListener('change', function () {
      var f = fileImportEl.files && fileImportEl.files[0];
      fileImportEl.value = '';
      if (f) importBackup(f);
    });

    $('#btnClear').addEventListener('click', function () {
      var n = HG.count();
      if (!n) { toast('本来就是空的'); return; }
      askConfirm({
        title: '清空全部数据？',
        message: '本机的 ' + n + ' 条倒计时会全部删掉，删除后无法恢复。建议先导出一份备份。',
        okText: '清空',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        if (!HG.clear()) { toast('清空失败，请重试'); return; }
        render();
        toast('已清空');
      });
    });

    confirmOkEl.addEventListener('click', function () { resolveConfirm(true); });
    confirmCancelEl.addEventListener('click', function () { resolveConfirm(false); });

    /* 分享视图 */
    $('#btnShareClose').addEventListener('click', closeShareView);
    $('#btnShareMine').addEventListener('click', closeShareView);
    $('#btnShareImport').addEventListener('click', function () {
      if (!state.sharedItem) return;
      var res = HG.add(state.sharedItem);
      if (!res.ok) { toast(res.error); return; }
      closeShareView();
      toast('已加入你的列表');
    });

    /* 装到主屏幕 */
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      window.__hourglassInstall = ev;
      btnInstallEl.classList.remove('hidden');
      installTextEl.textContent = '点下面的按钮，把 Hourglass 加到手机主屏幕，以后一键打开。';
    });

    btnInstallEl.addEventListener('click', function () {
      var ev = window.__hourglassInstall;
      if (!ev) { toast('请用浏览器菜单里的「添加到主屏幕」'); return; }
      window.__hourglassInstall = null;
      btnInstallEl.classList.add('hidden');
      ev.prompt();
    });

    window.addEventListener('appinstalled', function () { toast('已添加到主屏幕'); });

    /* 跨过零点时刷新天数 */
    setInterval(function () {
      var t = HG.todayISO();
      if (t !== lastToday) { lastToday = t; render(); }
    }, 30000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var t = HG.todayISO();
      if (t !== lastToday) { lastToday = t; render(); }
    });
  }

  /* ================= 启动 ================= */

  function init() {
    if (!HG.storageAvailable()) {
      storageWarnEl.textContent = '这台手机的浏览器不允许保存数据（可能开着无痕模式），关掉页面后你添加的倒计时就不见了。建议换普通模式打开。';
      storageWarnEl.classList.remove('hidden');
    }

    bindEvents();
    var showingShare = initShareView();
    render();
    if (showingShare) return;

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
          console.warn('Hourglass: 离线缓存没注册上，不影响使用', err);
        });
      });
    }
  }

  init();
})();
