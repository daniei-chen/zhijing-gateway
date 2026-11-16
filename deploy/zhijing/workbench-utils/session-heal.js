(function () {
  var KEY = 'auth_session_identity_v1';
  var MARK = 'zhijing_session_heal_at';
  var HEX64 = /^[a-f0-9]{64}$/;

  function readSubject() {
    try {
      var user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      var id = user && typeof user.id === 'number' && Number.isSafeInteger(user.id) && user.id > 0
        ? user.id
        : null;
      return id === null ? null : String(id);
    } catch (error) {
      return null;
    }
  }

  function drop() {
    try {
      localStorage.removeItem(KEY);
    } catch (error) {
      /* storage unavailable */
    }
  }

  try {
    var raw = localStorage.getItem(KEY);
    if (raw === null) {
      return;
    }

    var record = null;
    try {
      record = JSON.parse(raw);
    } catch (error) {
      record = null;
    }

    var subject = readSubject();
    var shapeOk =
      record &&
      typeof record.generation === 'string' &&
      record.generation.length > 0 &&
      typeof record.credentials === 'string' &&
      HEX64.test(record.credentials) &&
      (record.subject === null || /^\d+$/.test(record.subject)) &&
      record.phase === 'ready';

    if (!shapeOk || record.subject !== subject) {
      drop();
      return;
    }

    // credentials is sha256([access_token, refresh_token]) captured when the record
    // was written. Only that digest can tell whether the record still describes the
    // tokens in storage, and crypto.subtle is async, so this completes after the app
    // has already had a chance to boot. A mismatch means a different build rotated
    // the tokens without updating this record, which blocks every request with a
    // client-side 409; dropping it lets the app re-adopt the real state.
    var last = Number(sessionStorage.getItem(MARK) || '0');
    if (last && Date.now() - last < 15000) {
      return;
    }

    var material = JSON.stringify([
      localStorage.getItem('auth_token'),
      localStorage.getItem('refresh_token')
    ]);

    crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(material))
      .then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
          hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        }
        if (hex === record.credentials) {
          return;
        }
        if (localStorage.getItem(KEY) !== raw) {
          return;
        }
        try {
          sessionStorage.setItem(MARK, String(Date.now()));
        } catch (error) {
          return;
        }
        drop();
        location.reload();
      })
      .catch(function () {
        /* hashing unavailable: leave the app alone */
      });
  } catch (error) {
    /* never block the app */
  }
})();
