/* Hourglass 数据层
   只做两件事：读写本机 localStorage、把一条倒计时编码进分享链接。
   不发任何网络请求。 */
(function (global) {
  'use strict';

  var KEY = 'hourglass.v1';
  var COLORS = ['red', 'amber', 'lemon', 'lime', 'teal', 'blue', 'violet', 'pink'];

  var storageOK = null;   // null = 还没探测过
  var memory = null;      // localStorage 不可用时的内存兜底（关掉页面就没了）

  /* ---------- 本机存储可用性 ---------- */

  function storageAvailable() {
    if (storageOK !== null) return storageOK;
    try {
      var probe = '__hourglass_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      storageOK = true;
    } catch (e) {
      storageOK = false;
      console.warn('Hourglass: 本机存储不可用，数据将只保留在内存中', e);
    }
    return storageOK;
  }

  /* ---------- 日期工具 ---------- */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function todayISO(d) {
    var t = d ? new Date(d) : new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  /* 把 'YYYY-MM-DD' 解析成当地时间的 0 点；非法日期返回 null（会挡掉 2026-02-31 这类） */
  function parseISO(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (!y || !m || !d) return null;
    var dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /* 距离目标日还有几天：今天 = 0，明天 = 1，昨天 = -1。按当地 0 点做差，不受夏令时影响。 */
  function daysUntil(iso) {
    var target = parseISO(iso);
    if (!target) return null;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - now.getTime()) / 86400000);
  }

  function formatDate(iso, withWeekday) {
    var d = parseISO(iso);
    if (!d) return '';
    var s = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (withWeekday) s += ' 周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return s;
  }

  /* ---------- 条目 ---------- */

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* 统一校验 + 清洗：名称或日期不合法就丢，宁可不显示也不让坏数据进列表 */
  function normalize(raw, keepId) {
    if (!raw || typeof raw !== 'object') return null;
    var date = typeof raw.date === 'string' ? raw.date.trim() : '';
    if (!parseISO(date)) return null;
    var title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 40) : '';
    if (!title) return null;
    return {
      id: (keepId !== false && typeof raw.id === 'string' && raw.id) ? raw.id : uid(),
      title: title,
      /* 统一成 2026-02-03 这种规范写法，手改过的备份也不会让日期控件显示空白 */
      date: todayISO(parseISO(date)),
      note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 60) : '',
      color: COLORS.indexOf(raw.color) >= 0 ? raw.color : COLORS[0]
    };
  }

  /* ---------- 读写 ---------- */

  function readAll() {
    if (!storageAvailable()) return memory ? memory.slice() : [];
    var txt;
    try {
      txt = localStorage.getItem(KEY);
    } catch (e) {
      console.error('Hourglass: 读取本机存储失败', e);
      return memory ? memory.slice() : [];
    }
    if (!txt) return [];

    var parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      /* 解析失败时宁可显示空列表也不覆盖：原始内容留在存储里，等用户自己导出检查 */
      console.error('Hourglass: 本机数据不是合法 JSON，已忽略以免覆盖。原始内容：', txt);
      return [];
    }

    var arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
    var out = [];
    var dropped = 0;
    for (var i = 0; i < arr.length; i++) {
      var it = normalize(arr[i], true);
      if (it) out.push(it); else dropped++;
    }
    if (dropped) console.warn('Hourglass: 有 ' + dropped + ' 条数据格式不合法，已跳过');
    return out;
  }

  function writeAll(items) {
    if (!storageAvailable()) {
      memory = items.slice();
      return true;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, items: items }));
      return true;
    } catch (e) {
      console.error('Hourglass: 写入本机存储失败', e);
      return false;
    }
  }

  /* ---------- 对外接口 ---------- */

  function list() { return readAll(); }

  function get(id) {
    var items = readAll();
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function count() { return readAll().length; }

  function add(data) {
    var items = readAll();
    var it = normalize({ title: data.title, date: data.date, note: data.note, color: data.color }, false);
    if (!it) return { ok: false, error: '名称和目标日期都要填才算数' };
    items.push(it);
    if (!writeAll(items)) return { ok: false, error: '本机存储写入失败（可能是隐私模式或空间已满）' };
    return { ok: true, item: it };
  }

  function update(id, patch) {
    var items = readAll();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id !== id) continue;
      var merged = normalize({
        id: id,
        title: patch.title !== undefined ? patch.title : items[i].title,
        date: patch.date !== undefined ? patch.date : items[i].date,
        note: patch.note !== undefined ? patch.note : items[i].note,
        color: patch.color !== undefined ? patch.color : items[i].color
      }, true);
      if (!merged) return { ok: false, error: '名称和目标日期都要填才算数' };
      items[i] = merged;
      if (!writeAll(items)) return { ok: false, error: '本机存储写入失败' };
      return { ok: true, item: merged };
    }
    return { ok: false, error: '这条倒计时已经不在了' };
  }

  function remove(id) {
    var items = readAll();
    var rest = items.filter(function (i) { return i.id !== id; });
    if (rest.length === items.length) return { ok: false, error: '这条倒计时已经不在了' };
    if (!writeAll(rest)) return { ok: false, error: '本机存储写入失败' };
    return { ok: true };
  }

  /* 按给定的 id 顺序重排；没出现在新顺序里的条目保留在尾部 */
  function setOrder(ids) {
    var items = readAll();
    var map = {};
    items.forEach(function (i) { map[i.id] = i; });
    var out = [];
    ids.forEach(function (id) {
      if (map[id]) { out.push(map[id]); delete map[id]; }
    });
    items.forEach(function (i) { if (map[i.id]) out.push(i); });
    return writeAll(out);
  }

  function clear() { return writeAll([]); }

  /* ---------- 备份 ---------- */

  function exportPayload() {
    return { app: 'Hourglass', v: 1, exportedAt: new Date().toISOString(), items: readAll() };
  }

  /* 合并导入：同 id 的更新，新 id 的追加 */
  function importPayload(payload) {
    var incoming = payload && (Array.isArray(payload.items) ? payload.items : (Array.isArray(payload) ? payload : null));
    if (!incoming) return { ok: false, error: '这个文件不是 Hourglass 的备份' };

    var items = readAll();
    var index = {};
    items.forEach(function (i, n) { index[i.id] = n; });

    var added = 0, updated = 0, skipped = 0;
    incoming.forEach(function (raw) {
      var it = normalize(raw, true);
      if (!it) { skipped++; return; }
      var at = index[it.id];
      if (at === undefined) {
        items.push(it);
        index[it.id] = items.length - 1;
        added++;
      } else {
        var old = items[at];
        if (old.title !== it.title || old.date !== it.date || old.note !== it.note || old.color !== it.color) {
          items[at] = it;
          updated++;
        } else {
          skipped++;
        }
      }
    });

    if (!writeAll(items)) return { ok: false, error: '本机存储写入失败' };
    return { ok: true, added: added, updated: updated, skipped: skipped };
  }

  /* ---------- 分享链接的编解码 ---------- */

  function base64UrlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(code) {
    var b = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* 只带必要字段，链接才不至于长到没法发 */
  function encodeShare(item) {
    return base64UrlEncode(JSON.stringify({
      t: item.title, d: item.date, n: item.note || '', c: item.color
    }));
  }

  function decodeShare(code) {
    var json, obj;
    try { json = base64UrlDecode(code); } catch (e) { return null; }
    try { obj = JSON.parse(json); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    return normalize({ title: obj.t, date: obj.d, note: obj.n, color: obj.c }, false);
  }

  global.Hourglass = {
    COLORS: COLORS,
    storageAvailable: storageAvailable,
    todayISO: todayISO,
    parseISO: parseISO,
    daysUntil: daysUntil,
    formatDate: formatDate,
    list: list,
    get: get,
    count: count,
    add: add,
    update: update,
    remove: remove,
    setOrder: setOrder,
    clear: clear,
    exportPayload: exportPayload,
    importPayload: importPayload,
    encodeShare: encodeShare,
    decodeShare: decodeShare
  };
})(window);
