// Runs in the page's own JS world at document_start. The time card talks to its API gateway with a Bearer
// token (plus a gateway header); we copy those two headers from the page's own requests so the extension
// can call the same API on the user's behalf, from inside the page. Nothing is sent anywhere else.
(() => {
  if (window.__tpCapture) return;
  const state = (window.__tpCapture = { headers: {} });
  const WANTED = ["authorization", "x-gateway-group"];

  const remember = (rawUrl, headers) => {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api-gw/")) return;
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (WANTED.includes(key) && value) state.headers[key] = value; // keep the latest: tokens rotate
    }
  };

  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tp = { url, headers: {} };
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__tp) this.__tp.headers[name] = value;
    return setHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__tp) remember(this.__tp.url, this.__tp.headers);
    return send.apply(this, args);
  };

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const headers = {};
      new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined)).forEach((value, name) => {
        headers[name] = value;
      });
      remember(typeof input === "string" ? input : input.url, headers);
    } catch {
      // never break the page because of capture
    }
    return nativeFetch.apply(this, arguments);
  };
})();
