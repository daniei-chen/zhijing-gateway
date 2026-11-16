(function () {
  var keys = [
    'auth_session_identity_v1',
    'auth_token',
    'refresh_token',
    'auth_user',
    'token_expires_at',
    'register_data'
  ];
  var removed = [];

  try {
    keys.forEach(function (key) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        removed.push(key);
      }
    });
    sessionStorage.removeItem('auth_expired');
  } catch (error) {
    removed.push('清理失败: ' + error.message);
  }

  var result = document.getElementById('result');
  if (result) {
    result.textContent = removed.length
      ? '已清理 ' + removed.length + ' 项本地会话记录：' + removed.join('、') + '。即将跳转到登录页。'
      : '本地没有残留会话记录，可直接登录。即将跳转到登录页。';
  }

  var go = document.getElementById('go');
  if (go) {
    go.hidden = false;
  }

  setTimeout(function () {
    location.replace('/login');
  }, 2500);
})();
