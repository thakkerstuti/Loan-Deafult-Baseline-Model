import React, { useState, useEffect } from 'react';
import Auth from './components/Auth';
import BankDashboard from './components/BankDashboard';
import BorrowerPortal from './components/BorrowerPortal';

export default function App() {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('lg-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lg-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  if (!user) {
    return <Auth onLogin={setUser} theme={theme} toggleTheme={toggleTheme} />;
  }

  return (
    <>
      {user.type === 'bank' ? (
        <BankDashboard user={user} onLogout={() => setUser(null)} theme={theme} toggleTheme={toggleTheme} />
      ) : (
        <BorrowerPortal user={user} onLogout={() => setUser(null)} theme={theme} toggleTheme={toggleTheme} />
      )}
    </>
  );
}
