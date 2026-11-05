const express = require('express');
const { auth, authStore, loadToken, safeEqual, sameOrigin, COOKIE_NAME,
  setSessionCookie, rateCheck, rateFail, rateClear, requireSession } = require('./middleware.auth');
const router = express.Router();

router.use('/api/auth', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.get('/api/auth/status', (req, res) => res.json({
  service: 'my-books', auth_version: 1, initialized: auth.initialized(),
  // legacy 字段保留给旧客户端；整库公开读已移除，匿名只能访问白名单公开 API。
  public_read: false,
  public_pages: true,
}));

router.post('/api/auth/login', async (req, res, next) => {
  try {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不匹配', code: 'ORIGIN_REJECTED' });
    if (!auth.initialized()) return res.status(503).json({ error: '请先在服务器运行 npm run setup', code: 'SETUP_REQUIRED' });
    if (!rateCheck(req, res)) return;
    const { username, password, token, device_name, device_key } = req.body || {};
    const master = loadToken();
    const valid = typeof token === 'string' && token.length <= 1024 && master && safeEqual(token, master)
      || await authStore.verifyPassword(username, password);
    if (!valid) {
      rateFail(req);
      return res.status(401).json({ error: '用户名、密码或管理员令牌不正确', code: 'AUTH_REQUIRED' });
    }
    // 登录成功后轮换当前 Cookie/Bearer 会话，兼容尚未绑定 device_key 的旧客户端。
    const previousSession = auth.authenticate(req);
    const session = authStore.issueSession(device_name, device_key, previousSession?.id);
    rateClear(req);
    setSessionCookie(req, res, session.token);
    res.json(session);
  } catch (err) { next(err); }
});

router.get('/api/auth/me', requireSession, (req, res) => res.json({
  authenticated: true, device: { id: req.authSession.id, label: req.authSession.label },
}));
router.get('/api/auth/devices', requireSession, (req, res) => res.json(authStore.listSessions()));
router.delete('/api/auth/devices/:id', requireSession, (req, res) => {
  authStore.revoke(req.params.id);
  res.status(204).end();
});
router.post('/api/auth/logout', requireSession, (req, res) => {
  authStore.revoke(req.authSession.id);
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'lax' });
  res.status(204).end();
});
module.exports = router;
