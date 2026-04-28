import React, { useState } from 'react';
import { apiUrl } from '../api';

export default function Auth({ onLogin, theme, toggleTheme }) {
  const [role, setRole] = useState('borrower');
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    first: '', last: '', email: '', password: '', confirmPassword: ''
  });

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const validatePassword = (pw) => {
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter.";
    if (!/[0-9]/.test(pw)) return "Password must contain a number.";
    return null;
  };

  const handleSubmit = async () => {
    setError('');
    if (!form.email || !form.password) {
      setError('Please fill all required fields');
      return;
    }

    if (!form.email.toLowerCase().endsWith('@gmail.com')) {
      setError('Only @gmail.com email addresses are allowed.');
      return;
    }

    if (isSignup) {
      if (!form.first || !form.last) {
        setError('Please enter your full name');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      const pwErr = validatePassword(form.password);
      if (pwErr) {
        setError(pwErr);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(apiUrl('/api/signup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: form.first,
            last_name: form.last,
            email: form.email,
            password: form.password,
            role: role
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signup failed');
        alert('Account created! You can now sign in.');
        setIsSignup(false);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      try {
        const res = await fetch(apiUrl('/api/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        onLogin(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="screen active">
      <div className="auth-bg">
        <div className="auth-card">
          <div className="ah">
            <div className="ah-grid" />
            <div className="ah-orb ah-orb1" />
            <div className="ah-orb ah-orb2" />
            <div className="ah-scan" />
            
            <div className="ah-z">
              <div className="brand">
                <div className="brand-mark">G</div>
                <div>
                  <div className="brand-name">Ground<em>Zero</em></div>
                  <div className="brand-tag">Default Risk Intelligence</div>
                </div>
              </div>
            </div>

            <div className="ah-z" style={{ marginTop: 'auto' }}>
              <div className="ah-headline" style={{ marginTop: '12px' }}>
                Two portals.<br /><em style={{color:'var(--gold)'}}>One platform.</em>
              </div>
              <div style={{ marginTop: '24px', fontSize: '13px', lineHeight: '1.6', color: 'var(--text2)' }}>
                <p style={{ marginBottom: '16px' }}><strong style={{ color: 'var(--gold)' }}>Bank Analysts</strong> — Full risk dashboard, real LR scoring, and business insights.</p>
                <p><strong style={{ color: 'var(--sky)' }}>Borrowers</strong> — Submit application, see your risk score, and repayment schedule.</p>
              </div>
            </div>
          </div>

          <div className="af">
            <div className="af-thm">
              <button className="theme-btn" onClick={toggleTheme}>
                <div className="theme-btn-thumb">{theme === 'dark' ? '🌙' : '☀️'}</div>
              </button>
            </div>

            <h1 className="af-h">{isSignup ? 'Create account' : 'Sign in'}</h1>
            <p className="af-sub">{isSignup ? 'Join GroundZero today' : 'Enter your credentials to access the portal'}</p>

            <div className="role-tabs">
              <button className={`rtab ${role === 'bank' ? 'on' : ''}`} onClick={() => setRole('bank')}>🏦 Bank</button>
              <button className={`rtab ${role === 'borrower' ? 'on' : ''}`} onClick={() => setRole('borrower')}>👤 Borrower</button>
            </div>

            {error && <div style={{ padding: '10px', background: 'rgba(232,84,117,0.1)', border: '1px solid var(--rose)', borderRadius: '8px', color: 'var(--rose)', fontSize: '12px', marginBottom: '16px' }}>⚠️ {error}</div>}

            {isSignup && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div className="fg">
                  <label>First Name</label>
                  <input type="text" className="fi" value={form.first} onChange={e => update('first', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Last Name</label>
                  <input type="text" className="fi" value={form.last} onChange={e => update('last', e.target.value)} />
                </div>
              </div>
            )}

            <div className="fg">
              <label>Email Address</label>
              <input type="email" className="fi" value={form.email} onChange={e => update('email', e.target.value)} placeholder="name@email.com" />
            </div>

            <div className="fg">
              <label>Password</label>
              <input type="password" className="fi" value={form.password} onChange={e => update('password', e.target.value)} placeholder="••••••••" />
              {isSignup && <div style={{fontSize:'10px', color:'var(--text3)', marginTop:'4px'}}>Tip: Use 8+ chars with uppercase & numbers</div>}
            </div>

            {isSignup && (
              <div className="fg">
                <label>Confirm Password</label>
                <input type="password" className="fi" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} placeholder="••••••••" />
              </div>
            )}

            <button className="btn-main" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Processing...' : isSignup ? 'Create Account →' : 'Sign in →'}
            </button>

            <div className="auth-link">
              {isSignup ? 'Have an account?' : 'New to GroundZero?'} 
              <a onClick={() => { setIsSignup(!isSignup); setError(''); }}> {isSignup ? 'Sign in' : 'Create Account'}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
