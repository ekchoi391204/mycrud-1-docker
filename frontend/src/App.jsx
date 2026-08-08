import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, clearSessionToken, setSessionToken } from './api';

const FRONT_VERSION = '1.0.0';

function AuthCard({ mode }) {
  const navigate = useNavigate();
  const isRegister = mode === 'register';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/auth/me').then(() => navigate('/member', { replace: true })).catch(() => {});
  }, [navigate]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    if (isRegister && form.get('password') !== form.get('passwordConfirm')) {
      setError('비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    try {
      const session = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({
          username: form.get('username').trim(),
          password: form.get('password'),
        }),
      });
      setSessionToken(session.access_token);
      navigate('/member', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">C</div>
        <h1>{isRegister ? '새 계정 만들기' : '다시 오신 것을 환영합니다'}</h1>
        <p className="intro">
          {isRegister ? '사용할 아이디와 비밀번호를 입력하세요.' : '대시보드를 이용하려면 계정으로 로그인하세요.'}
        </p>
        <form onSubmit={submit}>
          <label>아이디<input name="username" minLength={isRegister ? 3 : 1} maxLength="30" pattern={isRegister ? '[A-Za-z0-9_.-]+' : undefined} autoComplete="username" required /></label>
          <label>비밀번호<input name="password" type="password" minLength={isRegister ? 8 : 1} maxLength="128" autoComplete={isRegister ? 'new-password' : 'current-password'} required /></label>
          {isRegister && <label>비밀번호 확인<input name="passwordConfirm" type="password" minLength="8" maxLength="128" autoComplete="new-password" required /></label>}
          <p className="error" role="alert">{error}</p>
          <button className="btn primary wide" disabled={busy}>{busy ? '처리 중…' : isRegister ? '가입하고 시작하기' : '로그인'}</button>
        </form>
        <p className="switch">
          {isRegister ? '이미 계정이 있나요?' : '계정이 없나요?'}{' '}
          <Link to={isRegister ? '/login' : '/register'}>{isRegister ? '로그인' : '회원가입'}</Link>
        </p>
      </section>
    </main>
  );
}

function PersonModal({ person, onClose, onSaved }) {
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(person ? `/api/members/${person.id}` : '/api/members', {
      method: person ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: form.get('name').trim(),
        gender: form.get('gender'),
        age: Number(form.get('age')),
      }),
    });
    onSaved(person ? '사용자 정보를 수정했습니다.' : '새 사용자를 추가했습니다.');
  }

  return (
    <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal-card" onSubmit={submit}>
        <h2>{person ? '사용자 수정' : '사용자 추가'}</h2>
        <label>이름<input name="name" defaultValue={person?.name} maxLength="100" autoFocus required /></label>
        <label>성별<select name="gender" defaultValue={person?.gender || 'Male'}><option value="Male">남성</option><option value="Female">여성</option></select></label>
        <label>나이<input name="age" type="number" min="0" max="150" defaultValue={person?.age} required /></label>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>취소</button><button className="btn primary">저장</button></div>
      </form>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [meta, setMeta] = useState({});
  const [people, setPeople] = useState([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(undefined);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const handleError = useCallback((err) => {
    if (err.status === 401) navigate('/login', { replace: true });
    else setError(err.message);
  }, [navigate]);

  const loadPeople = useCallback(async (search = '') => {
    try {
      const data = await api(`/api/members?q=${encodeURIComponent(search)}`);
      setPeople(data.items);
      setTotal(data.total);
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  useEffect(() => {
    Promise.all([api('/api/auth/me'), api('/api/system/meta')])
      .then(([user, system]) => { setAccount(user); setMeta(system); })
      .catch(handleError);
  }, [handleError]);

  useEffect(() => {
    const timer = setTimeout(() => loadPeople(query), 250);
    return () => clearTimeout(timer);
  }, [query, loadPeople]);

  function saved(message) {
    setModal(undefined);
    setToast(message);
    setTimeout(() => setToast(''), 2200);
    loadPeople(query);
  }

  async function remove(person) {
    if (!window.confirm(`"${person.name}" 사용자를 삭제하시겠습니까?`)) return;
    try {
      await api(`/api/members/${person.id}`, { method: 'DELETE' });
      saved('사용자를 삭제했습니다.');
    } catch (err) {
      handleError(err);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      clearSessionToken();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="shell">
      <header className="topbar"><div className="topbar-inner"><div className="brand"><span className="brand-mark">C</span>CRUD System</div><div className="nav-right"><span className="version">Front {FRONT_VERSION} · API {meta.version || '-'}</span><span className="avatar">{account?.username?.[0]?.toUpperCase() || 'A'}</span><button className="btn secondary" onClick={logout}>로그아웃</button></div></div></header>
      <main className="content">
        <section className="hero"><p>REACT · FASTAPI · MYSQL 8.0</p><h1>{account?.username || '관리자'}님, 안녕하세요</h1><span>사용자 데이터를 한 곳에서 편리하게 관리하세요.</span></section>
        <section className="panel">
          <div className="panel-head"><div><h2>사용자 관리</h2><p>등록된 사용자 정보를 조회하고 변경합니다.</p></div><div className="actions"><input aria-label="이름 검색" placeholder="이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="btn primary" onClick={() => setModal(null)}>+ 사용자 추가</button></div></div>
          {error && <p className="panel-error">{error}</p>}
          <div className="table-wrap"><table><thead><tr><th>이름</th><th>성별</th><th>나이</th><th>작업</th></tr></thead><tbody>
            {people.map((person) => <tr key={person.id}><td data-label="이름" className="person-name">{person.name}</td><td data-label="성별"><span className={`badge ${person.gender.toLowerCase()}`}>{person.gender === 'Male' ? '남성' : '여성'}</span></td><td data-label="나이">{person.age}세</td><td data-label="작업" className="row-actions"><button onClick={() => setModal(person)}>수정</button><button className="danger" onClick={() => remove(person)}>삭제</button></td></tr>)}
          </tbody></table>{people.length === 0 && <div className="empty">조건에 맞는 사용자가 없습니다.</div>}</div>
          <div className="panel-foot">총 <strong>{total}</strong>명의 사용자</div>
        </section>
      </main>
      <footer><div className="footer-inner">{[['서버 IP', meta.server_ip], ['서버명', meta.server_name], ['클라이언트 IP', meta.ip], ['X-Forwarded-For', meta.xff]].map(([label, value]) => <div className="meta-card" key={label}><small>{label}</small><strong>{value || '-'}</strong></div>)}</div></footer>
      {modal !== undefined && <PersonModal person={modal} onClose={() => setModal(undefined)} onSaved={saved} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Health() {
  const [health, setHealth] = useState(null);
  const [checkedAt, setCheckedAt] = useState('');
  const check = useCallback(() => {
    fetch('/health', { cache: 'no-store' })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => setHealth({ ...data, ok: response.ok }))
      .catch(() => setHealth({ ok: false, app: 'error', database: 'error', redis: 'error', http_status: '연결 실패' }))
      .finally(() => setCheckedAt(new Date().toLocaleString('ko-KR')));
  }, []);
  useEffect(() => { check(); const timer = setInterval(check, 30000); return () => clearInterval(timer); }, [check]);
  return <main className="health-page"><section className="health-card"><div className="health-head"><div><p>PUBLIC SERVICE STATUS</p><h1>서비스 상태</h1><span>FastAPI, MySQL, Redis 연결 상태를 확인합니다.</span></div><b className={health?.ok ? 'healthy' : 'unhealthy'}>{health?.http_status || '확인 중'}</b></div><div className="health-grid"><article><i>API</i><div><small>FastAPI 서버</small><strong>{health?.app === 'ok' ? '정상' : '확인 중'}</strong></div></article><article><i>DB</i><div><small>MySQL 데이터베이스</small><strong>{health?.database === 'ok' ? '정상' : '연결 실패'}</strong></div></article><article><i>REDIS</i><div><small>Redis 세션 저장소</small><strong>{health?.redis === 'ok' ? '정상' : '연결 실패'}</strong></div></article></div><p>버전 {health?.version || '-'} · 마지막 확인 {checkedAt || '-'}</p><button className="btn primary" onClick={check}>지금 다시 확인</button></section></main>;
}

export default function App() {
  return <Routes><Route path="/login" element={<AuthCard mode="login" />} /><Route path="/register" element={<AuthCard mode="register" />} /><Route path="/member" element={<Dashboard />} /><Route path="/status" element={<Health />} /><Route path="/" element={<Navigate to="/member" replace />} /><Route path="*" element={<Navigate to="/member" replace />} /></Routes>;
}
