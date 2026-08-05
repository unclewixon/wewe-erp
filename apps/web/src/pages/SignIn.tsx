import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';

export function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { user } = await api.post<{ user: User }>('/v1/auth/login', { email, password });
      onSignedIn(user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin-wrap">
      <form className="signin-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 4 }}>
          <div className="brand-mark">W</div>
          <div className="brand-name">WEWE ERP</div>
        </div>
        <div className="signin-tagline">One approval chain. Five stages. Zero paper.</div>
        {error ? <div className="banner danger">{error}</div> : null}
        <div className="field">
          <label>Work email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@wewe.org" autoFocus required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn primary" style={{ width: '100%', height: 42, marginTop: 6 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--faint)' }}>
          Demo accounts use password <b>Password1!</b> — try ibrahim.musa@wewe.org (Finance) or amina.yusuf@wewe.org (Initiator).
        </div>
      </form>
    </div>
  );
}
