/* Hourglass 离线缓存
   页面本身是纯静态的，缓存住之后没网也能打开看倒计时。 */
var CACHE = 'hourglass-v1';

var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-1024.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* 单个文件缺失不应该让整个缓存装不上 */
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('Hourglass: 离线缓存跳过 ' + url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* 打开页面：优先联网拿最新版，断网时回落到缓存里的首页 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        put(req, res.clone());
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* 其它资源：也是先联网拿最新，断网时用缓存兜底。
     不用「缓存优先」是为了避免改了样式或脚本后，老用户一直看到旧版本。 */
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) put(req, res.clone());
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});

function put(req, res) {
  caches.open(CACHE).then(function (cache) {
    cache.put(req, res).catch(function (err) {
      console.warn('Hourglass: 缓存写入失败', err);
    });
  });
}
