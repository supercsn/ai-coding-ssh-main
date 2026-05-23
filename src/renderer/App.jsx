import { useCallback, useEffect, useMemo, useState } from 'react';

const defaultServer = () => ({
  name: '',
  host: '',
  sshPort: 22,
  username: '',
  remotePort: 18080,
  privateKeyPath: '',
});

const defaultOutboundForm = () => ({
  localProxyHost: '127.0.0.1',
  localProxyPort: 7890,
});

function useAiApi() {
  // @ts-ignore
  const api = window.aiCodingSsh;
  if (!api) {
    throw new Error('preload 未加载');
  }
  return api;
}

export default function App() {
  const api = useAiApi();

  const [encOk, setEncOk] = useState(true);
  const [proxy, setProxy] = useState(null);
  const [servers, setServers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(defaultServer);
  const [secrets, setSecrets] = useState({
    password: '',
    privateKey: '',
    passphrase: '',
  });
  const [runtimePassword, setRuntimePassword] = useState('');
  const [tunnels, setTunnels] = useState([]);
  const [logs, setLogs] = useState('');
  const [message, setMessage] = useState('');
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [remotePortBusy, setRemotePortBusy] = useState(false);
  const [outboundForm, setOutboundForm] = useState(defaultOutboundForm);

  const refreshProxy = useCallback(async () => {
    const st = await api.proxyStatus();
    setProxy(st);
    if (st.prefs) {
      setOutboundForm({
        localProxyHost: st.prefs.localProxyHost ?? '127.0.0.1',
        localProxyPort: st.prefs.localProxyPort ?? 7890,
      });
    }
  }, [api]);

  const refreshServers = useCallback(async () => {
    const list = await api.listServers();
    setServers(list);
    setSelectedId((cur) => {
      if (cur && list.some((s) => s.id === cur)) return cur;
      return list.length ? list[0].id : null;
    });
  }, [api]);

  useEffect(() => {
    void (async () => {
      const e = await api.encryptionAvailable();
      setEncOk(Boolean(e));
      await refreshProxy();
      await refreshServers();
    })();
  }, [api, refreshProxy, refreshServers]);

  useEffect(() => {
    void api.listTunnels().then((t) => setTunnels(t || []));
  }, [api]);

  useEffect(() => {
    const off = api.onTunnelLog(({ serverId, line }) => {
      if (serverId === selectedId) {
        setLogs((prev) => `${prev}\n${line}`.trim());
      }
    });
    const off2 = api.onTunnelState(({ tunnels: t }) => setTunnels(t || []));
    return () => {
      off();
      off2();
    };
  }, [api, selectedId]);

  useEffect(() => {
    void (async () => {
      if (!selectedId) {
        setLogs('');
        return;
      }
      const t = await api.tunnelLogs(selectedId);
      setLogs(t.join('\n'));
    })();
  }, [selectedId, api]);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) || null,
    [servers, selectedId],
  );

  const isConnected = useMemo(
    () => tunnels.some((t) => t.serverId === selectedId),
    [tunnels, selectedId],
  );

  const loadSelectedIntoForm = () => {
    if (!selected) return;
    setForm({
      name: selected.name,
      host: selected.host,
      sshPort: selected.sshPort ?? 22,
      username: selected.username,
      remotePort: selected.remotePort ?? 18080,
      privateKeyPath: selected.privateKeyPath || '',
    });
    setSecrets({
      password: '',
      privateKey: '',
      passphrase: '',
    });
  };

  const onSave = async () => {
    setMessage('');
    try {
      const record = {
        ...(selected?.id ? { id: selected.id } : {}),
        name: form.name || form.host,
        host: form.host.trim(),
        sshPort: Number(form.sshPort) || 22,
        username: form.username.trim(),
        remotePort: Number(form.remotePort) || 18080,
        privateKeyPath: form.privateKeyPath.trim(),
      };
      const sec = {};
      if (secrets.password) sec.password = secrets.password;
      if (secrets.privateKey) sec.privateKey = secrets.privateKey;
      if (secrets.passphrase) sec.passphrase = secrets.passphrase;

      const r = await api.saveServer({ record, secrets: sec });
      if (!r.secretsPersisted && Object.keys(sec).length) {
        setMessage(
          '已保存服务器。注意：当前系统无法用安全存储加密凭据，私密信息未写入磁盘；每次连接前请在下方填写密码/私钥。',
        );
      } else {
        setMessage('已保存');
      }
      await refreshServers();
      setSelectedId(r.server.id);
    } catch (e) {
      setMessage(String(e.message || e));
    }
  };

  const onConnect = async () => {
    setMessage('');
    if (!selectedId || tunnelBusy) return;
    setTunnelBusy(true);
    try {
      const rt = {};
      if (runtimePassword.trim()) {
        rt.password = runtimePassword.trim();
      }
      await api.connectTunnel({ serverId: selectedId, runtimeSecrets: rt });
      setMessage('已连接');
    } catch (e) {
      setMessage(String(e.message || e));
    } finally {
      setTunnelBusy(false);
    }
  };

  const onDisconnect = async () => {
    setMessage('');
    if (!selectedId || tunnelBusy) return;
    setTunnelBusy(true);
    try {
      await api.disconnectTunnel(selectedId);
      setMessage('已断开');
    } catch (e) {
      setMessage(String(e.message || e));
    } finally {
      setTunnelBusy(false);
    }
  };

  const runtimeSecretsPayload = () => {
    const rt = {};
    if (runtimePassword.trim()) {
      rt.password = runtimePassword.trim();
    }
    return rt;
  };

  const onCheckRemotePort = async () => {
    setMessage('');
    if (!selectedId || remotePortBusy || isConnected) return;
    setRemotePortBusy(true);
    try {
      const st = await api.checkRemotePort({
        serverId: selectedId,
        runtimeSecrets: runtimeSecretsPayload(),
      });
      if (st.inUse) {
        setMessage(`远端 127.0.0.1:${st.remotePort} 已被占用${st.detail ? `：${st.detail}` : ''}`);
      } else {
        setMessage(`远端 127.0.0.1:${st.remotePort} 空闲，可以连接`);
      }
    } catch (e) {
      setMessage(String(e.message || e));
    } finally {
      setRemotePortBusy(false);
    }
  };

  const onReleaseRemotePort = async () => {
    setMessage('');
    if (!selectedId || remotePortBusy || isConnected) return;
    if (
      !confirm(
        `将 SSH 登录云主机并结束占用远端反向端口（127.0.0.1:${form.remotePort || 18080}）的残留 sshd 会话。继续？`,
      )
    ) {
      return;
    }
    setRemotePortBusy(true);
    try {
      await api.releaseRemotePort({
        serverId: selectedId,
        runtimeSecrets: runtimeSecretsPayload(),
      });
      setMessage('远端端口已释放，可以重新连接');
    } catch (e) {
      setMessage(String(e.message || e));
    } finally {
      setRemotePortBusy(false);
    }
  };

  const onApplyClaude = async () => {
    setMessage('');
    if (!selectedId) return;
    try {
      await api.applyRemoteClaudeSettings(selectedId);
      setMessage('已写入远端 ~/.claude/settings.json');
    } catch (e) {
      setMessage(String(e.message || e));
    }
  };

  const onRemoveClaude = async () => {
    setMessage('');
    if (!selectedId) return;
    try {
      await api.removeRemoteClaudeSettings(selectedId);
      setMessage('已移除远端 Claude 代理环境变量字段');
    } catch (e) {
      setMessage(String(e.message || e));
    }
  };

  const onDelete = async () => {
    if (!selectedId || !confirm('确定删除该服务器配置？')) return;
    await api.deleteServer(selectedId);
    setSelectedId(null);
    setForm(defaultServer());
    await refreshServers();
  };

  const onSaveOutbound = async () => {
    setMessage('');
    try {
      await api.proxyConfigure({
        localProxyHost: outboundForm.localProxyHost.trim() || '127.0.0.1',
        localProxyPort: Number(outboundForm.localProxyPort) || 7890,
      });
      await refreshProxy();
      setMessage('本机出站地址已保存');
    } catch (e) {
      setMessage(String(e.message || e));
    }
  };

  const statusLine = () => {
    if (!proxy) return '状态未知';
    const h = proxy.prefs?.localProxyHost ?? '127.0.0.1';
    const p = proxy.prefs?.localProxyPort ?? '?';
    if (proxy.ok) {
      return `本机出站 ${h}:${p} · TCP 可达`;
    }
    return `本机出站 ${h}:${p} · 不可达：${proxy.forwardProbeError || '请启动 Clash'}`;
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Claude SSH 隧道（Windows）</h1>
        <div
          className={`proxy-pill ${proxy?.ok ? 'ok' : 'bad'}`}
          title="本机 Clash / HTTP CONNECT 出站是否可连"
        >
          {statusLine()}
        </div>
      </header>

      <div className="layout">
        <section className="panel">
          <h2>本机出站（Clash）</h2>
          {!encOk && (
            <div className="warn">
              当前环境不可用操作系统安全存储，SSH 密码类凭据将不会落盘；请每次连接时填写。
            </div>
          )}
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 12px' }}>
            SSH 反向隧道把云上的 TCP 转到下面这个地址。请与 Clash 的 <strong>HTTP/MIXED</strong>{' '}
            监听一致（常见为 <code>127.0.0.1:7890</code>）。请使用 Windows 自带{' '}
            <code>OpenSSH\\ssh.exe</code> 或确保隧道进程能访问到本机 Clash。
          </p>
          <div className="proxy-form">
            <div className="field">
              <label>地址</label>
              <input
                value={outboundForm.localProxyHost}
                onChange={(e) =>
                  setOutboundForm((f) => ({ ...f, localProxyHost: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label>端口</label>
              <input
                type="number"
                value={outboundForm.localProxyPort}
                onChange={(e) =>
                  setOutboundForm((f) => ({
                    ...f,
                    localProxyPort:
                      Number.parseInt(e.target.value, 10) || f.localProxyPort,
                  }))
                }
              />
            </div>
          </div>
          <div className="row">
            <button type="button" className="secondary" onClick={refreshProxy}>
              刷新状态
            </button>
            <button type="button" onClick={onSaveOutbound}>
              保存出站设置
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>SSH 服务器</h2>
          {message && <div className="warn">{message}</div>}
          <div className="field">
            <label>已保存的配置</label>
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
            >
              <option value="">新建...</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.host} ({s.username}@{s.host})
                </option>
              ))}
            </select>
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSelectedId(null);
                setForm(defaultServer());
                setSecrets({ password: '', privateKey: '', passphrase: '' });
              }}
            >
              新建
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!selected}
              onClick={loadSelectedIntoForm}
            >
              载入到表单
            </button>
          </div>

          <div className="field">
            <label>显示名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>主机</label>
            <input
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>SSH 端口</label>
              <input
                type="number"
                value={form.sshPort}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sshPort: Number.parseInt(e.target.value, 10) || 22,
                  })
                }
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>远端反向端口</label>
              <input
                type="number"
                value={form.remotePort}
                onChange={(e) =>
                  setForm({
                    ...form,
                    remotePort:
                      Number.parseInt(e.target.value, 10) || 18080,
                  })
                }
              />
            </div>
          </div>
          <div className="field">
            <label>用户名</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 8px' }}>
            凭据可同时配置密码与私钥；连接时只要二者其一有效即可。
          </p>
          <div className="field">
            <label>SSH 密码（可选，可保存到本机加密库）</label>
            <input
              type="password"
              autoComplete="off"
              value={secrets.password}
              onChange={(e) =>
                setSecrets({ ...secrets, password: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>私钥文件路径（可选）</label>
            <input
              value={form.privateKeyPath}
              onChange={(e) =>
                setForm({ ...form, privateKeyPath: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>或直接粘贴私钥 PEM（可选）</label>
            <textarea
              value={secrets.privateKey}
              onChange={(e) =>
                setSecrets({ ...secrets, privateKey: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>私钥 passphrase（可选）</label>
            <input
              type="password"
              value={secrets.passphrase}
              onChange={(e) =>
                setSecrets({ ...secrets, passphrase: e.target.value })
              }
            />
          </div>

          <div className="row">
            <button type="button" onClick={onSave}>
              保存配置
            </button>
            <button
              type="button"
              className="danger"
              disabled={!selected}
              onClick={onDelete}
            >
              删除
            </button>
          </div>
        </section>

        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <h2>隧道与 Claude Code 远端配置</h2>
          <div className="server-card">
            <header>
              <strong>{selected ? selected.name || selected.host : '未选择服务器'}</strong>
              <span className={`badge ${isConnected ? 'on' : ''}`}>
                {isConnected ? '隧道已建立' : '未连接'}
              </span>
            </header>
            <div className="field">
              <label>本次连接临时密码（可选）</label>
              <input
                type="password"
                value={runtimePassword}
                onChange={(e) => setRuntimePassword(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                type="button"
                disabled={!selectedId || tunnelBusy || isConnected}
                onClick={onConnect}
              >
                {tunnelBusy && !isConnected ? '连接中…' : '连接（反向隧道）'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!selectedId || tunnelBusy || !isConnected}
                onClick={onDisconnect}
              >
                {tunnelBusy && isConnected ? '断开中…' : '断开'}
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '12px 0 8px' }}>
              断网后若重连失败、提示远端端口被占用：先点 <strong>断开</strong>（或托盘退出），再点{' '}
              <strong>释放远端端口</strong>。连接时也会自动尝试清理残留会话。
            </p>

            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={!selectedId || remotePortBusy || isConnected || tunnelBusy}
                onClick={onCheckRemotePort}
              >
                {remotePortBusy ? '检查中…' : '检查远端端口'}
              </button>
              <button
                type="button"
                className="danger"
                disabled={!selectedId || remotePortBusy || isConnected || tunnelBusy}
                onClick={onReleaseRemotePort}
              >
                {remotePortBusy ? '释放中…' : '释放远端端口'}
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '16px 0 8px' }}>
              连接成功后：<strong>写入 Claude settings</strong> 会向远端{' '}
              <code>$HOME/.claude/settings.json</code> 合并写入{' '}
              <code>HTTP_PROXY</code> / <code>HTTPS_PROXY</code>，指向{' '}
              <code>http://127.0.0.1:远端反向端口</code>，供 Claude Code / claude CLI 读取。
              请保证该远端端口<strong>只做</strong>本条 SSH{' '}
              <code>-R</code>
              ，不要与其它本地代理中继混在同一端口。
            </p>

            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={!selectedId || !isConnected}
                onClick={onApplyClaude}
              >
                写入 Claude settings
              </button>
              <button
                type="button"
                className="danger"
                disabled={!selectedId || !isConnected}
                onClick={onRemoveClaude}
              >
                移除 Claude 代理字段
              </button>
            </div>

            <div className="field">
              <label>日志</label>
              <div className="logs">{logs || '（无）'}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
