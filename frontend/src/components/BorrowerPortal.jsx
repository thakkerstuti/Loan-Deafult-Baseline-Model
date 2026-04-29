import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import ArthaAI from './ArthaAI';
import { calcRisk, buildSched, fmt, fmtK } from '../model';
import { apiUrl } from '../api';

export default function BorrowerPortal({ user, onLogout, theme, toggleTheme }) {
  const [page, setPage] = useState('bpg-apply');
  const [formData, setFormData] = useState({
    age: '', credit: '', income: '', loanAmt: '', dti: '', lines: '',
    purpose: 'other', term: 24, rate: '', empType: 'full', empl: '',
    edu: 'bach', marital: 'married', state: '', extLoanAmt: '', extEmi: '',
    customPurpose: '', customTerm: '', extBank: '', extLoanType: 'personal',
    jobChanges: ''
  });
  const [flags, setFlags] = useState({ mort: 'N', dep: 'N', co: 'N', extloan: 'N' });
  const [result, setResult] = useState(null);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [expandSched, setExpandSched] = useState(false);
  const [myApps, setMyApps] = useState([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  
  // States to preserve draft form while viewing a past application
  const [draftData, setDraftData] = useState(null);
  const [draftFlags, setDraftFlags] = useState(null);
  const [draftResult, setDraftResult] = useState(null);

  const eduMap = { hs: "High School", bach: "Bachelor's", mast: "Master's", phd: "PhD" };
  const empMap = { full: "Full-time", part: "Part-time", self: "Self-employed", unemployed: "Unemployed" };
  const maritalMap = { single: "Single", married: "Married", divorced: "Divorced" };
  const purposeMap = { home: "Home", auto: "Auto", education: "Education", business: "Business", other: "Other", custom: "Other", medical: "Other", personal: "Other" };

  const effectiveTerm = formData.term === 'custom' ? (parseInt(formData.customTerm) || 24) : (parseInt(formData.term) || 24);
  const displayPurpose = formData.purpose === 'custom' ? formData.customPurpose : (purposeMap[formData.purpose] || formData.purpose);

  const update = (k, v) => !isReadOnly && setFormData(prev => ({ ...prev, [k]: v }));
  const tog = (k, v) => !isReadOnly && setFlags(prev => ({ ...prev, [k]: v }));

  const fetchMyApps = async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(apiUrl(`/api/my-applications?email=${encodeURIComponent(user.email)}`));
      if (res.ok) {
        const data = await res.json();
        setMyApps(data);
      }
    } catch (err) {
      console.error('Failed to fetch my applications:', err);
    }
  };

  useEffect(() => {
    resetForm();
    fetchMyApps();
  }, [user.email]);

  const handleViewApp = (app) => {
    // Save current unsubmitted work before overwriting with historical data
    if (!isReadOnly) {
      setDraftData(formData);
      setDraftFlags(flags);
      setDraftResult(result);
    }

    const stdTerms = [12, 24, 36, 48, 60];
    const stdPurposes = ['home', 'auto', 'education', 'business', 'medical', 'personal', 'other'];
    const isCustomTerm = !stdTerms.includes(parseInt(app.term));
    const isCustomPurp = !stdPurposes.includes(app.loan_purpose?.toLowerCase());

    setFormData({
      age: app.age, credit: app.credit_score, income: app.income, loanAmt: app.loan_amount,
      dti: app.dti, lines: app.num_credit_lines, 
      purpose: isCustomPurp ? 'custom' : app.loan_purpose?.toLowerCase(),
      customPurpose: isCustomPurp ? app.loan_purpose : '',
      term: isCustomTerm ? 'custom' : parseInt(app.term), 
      customTerm: isCustomTerm ? app.term : '',
      rate: app.interest_rate, 
      empType: app.employment_type === "Full-time" ? "full" : app.employment_type === "Part-time" ? "part" : app.employment_type === "Self-employed" ? "self" : "unemployed",
      empl: app.months_employed, 
      edu: app.education === "High School" ? "hs" : app.education === "Bachelor's" ? "bach" : app.education === "Master's" ? "mast" : "phd",
      marital: app.marital_status?.toLowerCase(), state: app.state,
      extLoanAmt: 0, extEmi: 0, extBank: '', extLoanType: 'personal',
      jobChanges: app.job_changes || 0
    });
    setFlags({
      mort: app.has_mortgage === 'Yes' ? 'Y' : 'N',
      dep: app.has_dependents === 'Yes' ? 'Y' : 'N',
      co: app.has_cosigner === 'Yes' ? 'Y' : 'N',
      extloan: app.has_existing_loan === 'Yes' ? 'Y' : 'N'
    });
    
    const sched = buildSched(app.loan_amount, app.interest_rate, app.term);
    setResult({
      pct: Math.round(app.probability * 100),
      level: app.risk_category?.toLowerCase() || 'low',
      sched,
      prob: app.probability,
      hasExtLoan: app.has_existing_loan === 'Yes',
      extAmt: 0,
      extEmi: 0,
      pctWithout: null,
      riskDelta: 0,
      adjustedD: { ...app }
    });
    setIsReadOnly(true);
    setPage('bpg-view-app'); // New page for dual view
  };

  const resetForm = () => {
    setIsReadOnly(false);
    setResult(null);
    setFormData({
      age: '', credit: '', income: '', loanAmt: '', dti: '', lines: '',
      purpose: 'other', term: 24, rate: '', empType: 'full', empl: '',
      edu: 'bach', marital: 'married', state: '', extLoanAmt: '', extEmi: '',
      customPurpose: '', customTerm: '', extBank: '', extLoanType: 'personal',
      jobChanges: ''
    });
    setFlags({ mort: 'N', dep: 'N', co: 'N', extloan: 'N' });
    setDraftData(null);
    setDraftFlags(null);
    setDraftResult(null);
  };

  const handleSubmit = async () => {
    const requiredFields = [
      ['age', 'Age'],
      ['credit', 'Credit Score'],
      ['income', 'Annual Income'],
      ['loanAmt', 'Loan Amount'],
      ['dti', 'DTI Ratio'],
      ['lines', 'Credit Lines'],
      ['rate', 'Expected Interest Rate'],
      ['empl', 'Months Employed'],
      ['jobChanges', 'Job Changes']
    ];
    const missing = requiredFields
      .filter(([key]) => formData[key] === '' || formData[key] === null || Number.isNaN(Number(formData[key])))
      .map(([, label]) => label);

    if (missing.length) {
      alert(`Please enter valid values for: ${missing.join(', ')}`);
      return;
    }

    if (Number(formData.income) <= 0) { alert('Annual Income must be greater than 0'); return; }
    if (Number(formData.loanAmt) <= 0) { alert('Loan Amount must be greater than 0'); return; }
    if (Number(formData.dti) < 0 || Number(formData.dti) > 1) { alert('DTI Ratio must be between 0 and 1'); return; }

    const hasExtLoan = flags.extloan === 'Y';
    const extAmt = hasExtLoan ? formData.extLoanAmt : 0;
    const extEmi = hasExtLoan ? formData.extEmi : 0;

    let adjustedD = { ...formData };
    if (hasExtLoan) {
      const monthlyInc = formData.income / 12 || 1;
      adjustedD.dti = Math.min(formData.dti + (extEmi / monthlyInc), 0.99);
      adjustedD.lines = formData.lines + 1;
    }

    const effectivePurpose = formData.purpose === 'custom' ? (formData.customPurpose || "Other") : (formData.purpose || "other");

    const payload = {
      Age: adjustedD.age,
      Income: adjustedD.income,
      LoanAmount: adjustedD.loanAmt,
      CreditScore: adjustedD.credit,
      MonthsEmployed: adjustedD.empl,
      NumCreditLines: adjustedD.lines,
      InterestRate: adjustedD.rate,
      LoanTerm: effectiveTerm,
      DTIRatio: adjustedD.dti,
      Education: eduMap[adjustedD.edu] || "Bachelor's",
      EmploymentType: empMap[adjustedD.empType] || "Full-time",
      MaritalStatus: maritalMap[adjustedD.marital] || "Single",
      HasMortgage: flags.mort === 'Y' ? "Yes" : "No",
      HasDependents: flags.dep === 'Y' ? "Yes" : "No",
      LoanPurpose: purposeMap[effectivePurpose] || "Other",
      HasCoSigner: flags.co === 'Y' ? "Yes" : "No",
      HasExistingLoan: flags.extloan === 'Y' ? "Yes" : "No",
      ExistingBank: formData.extBank === 'custom' ? formData.extBankCustom : formData.extBank,
      ExistingRate: formData.extRate || 0,
      ExistingPurpose: formData.extLoanType === 'custom' ? formData.extLoanTypeCustom : formData.extLoanType,
      FullName: `${user?.first} ${user?.last}`.trim() || "Anonymous",
      Email: user?.email,
      State: formData.state || 'MH',
      JobChanges: formData.jobChanges || 0
    };

    try {
      const res = await fetch(apiUrl('/api/predict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('API error');
      const apiResult = await res.json();

      const prob = apiResult.default_probability;
      const pct = Math.round(prob * 100);
      const level = prob < 0.3 ? 'low' : prob < 0.6 ? 'med' : 'high';
      const probWithout = hasExtLoan ? calcRisk(formData, { mort: flags.mort, dep: flags.dep, co: flags.co }) : null;
      const pctWithout = probWithout ? Math.round(probWithout * 100) : null;
      const riskDelta = hasExtLoan ? (pct - pctWithout) : 0;
      const sched = buildSched(formData.loanAmt, formData.rate, effectiveTerm);

      setResult({ pct, level, sched, prob, hasExtLoan, extAmt, extEmi, pctWithout, riskDelta, adjustedD });
      if (typeof fetchMyApps === 'function') fetchMyApps();
      setPage('bpg-status');
    } catch (err) {
      // Fallback to local model if API is unavailable
      console.warn('[GroundZero] API unreachable, using local model fallback:', err);
      const prob = calcRisk(adjustedD, { mort: flags.mort === 'Y' || (hasExtLoan && formData.extLoanType === 'home') ? 'Y' : 'N', dep: flags.dep, co: flags.co });
      const pct = Math.round(prob * 100);
      const level = prob < 0.3 ? 'low' : prob < 0.6 ? 'med' : 'high';
      const probWithout = hasExtLoan ? calcRisk(formData, { mort: flags.mort, dep: flags.dep, co: flags.co }) : null;
      const pctWithout = probWithout ? Math.round(probWithout * 100) : null;
      const riskDelta = hasExtLoan ? (pct - pctWithout) : 0;
      const sched = buildSched(formData.loanAmt, formData.rate, effectiveTerm);
      setResult({ pct, level, sched, prob, hasExtLoan, extAmt, extEmi, pctWithout, riskDelta, adjustedD });
      if (typeof fetchMyApps === 'function') fetchMyApps();
      setPage('bpg-status');
    }
  };

  const [liveData, setLiveData] = useState({ btc: null, eth: null, loading: true });

  useEffect(() => {
    if (page === 'bpg-stocks') {
      setLiveData(prev => ({ ...prev, loading: true }));
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=inr&include_24hr_change=true')
        .then(res => res.json())
        .then(data => {
          setLiveData({
            btc: data.bitcoin,
            eth: data.ethereum,
            loading: false
          });
        })
        .catch(() => setLiveData(prev => ({ ...prev, loading: false })));
    }
  }, [page]);

  return (
    <div className="app-shell active">
      <Sidebar 
        user={user} 
        activePage={page} 
        setPage={(p) => {
          if (p === 'bpg-apply') {
            if (isReadOnly) {
              if (draftData) {
                setFormData(draftData);
                setFlags(draftFlags);
                setResult(draftResult);
                setIsReadOnly(false);
              } else {
                resetForm();
              }
            }
            // If already editing (!isReadOnly), do not reset form
          }
          setPage(p);
        }} 
        onLogout={onLogout} 
        type="borrower" 
        theme={theme} 
        toggleTheme={toggleTheme} 
      />
      
      <div className="main-area">
        <div className="topbar">
          <div className="tb-title">
            {page === 'bpg-status' ? 'My Loan Application' : page === 'bpg-apply' ? 'Submit Details' : page === 'bpg-stocks' ? 'Stock Investments' : 'Improve Score'}
          </div>
          <div className="tb-chip">
            {result ? `Status: ${result.level==='low'?'Approved':'Under Review'} · ${result.pct}%` : 'Draft Application'}
          </div>
        </div>

        <div className="page-content" style={{ padding: '26px' }}>
          {(page === 'bpg-apply' || page === 'bpg-view-app') && (
            <div className="fade-in">
              <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="pg-sub" style={{ fontSize: '18px' }}>
                  {isReadOnly ? (
                    <span>Viewing Application: <strong style={{color:'var(--sky)'}}>{user?.first} {user?.last}</strong></span>
                  ) : (
                    <span>Welcome, <strong style={{color:'var(--gold)'}}>{user?.first} {user?.last}</strong>. Please fill your loan details.</span>
                  )}
                </p>
                {isReadOnly && (
                  <button className="bp-btn" onClick={() => { resetForm(); setPage('bpg-apply'); }} style={{ padding: '8px 20px', width: 'auto', fontSize: '13px' }}>
                    + Start New Application
                  </button>
                )}
              </div>
              
              <div style={{ display: page === 'bpg-view-app' ? 'grid' : 'block', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                {/* CONTAINER 1: INPUTS */}
                <div className="card glass mb18">
                <div className="ch">
                  <div className="ct"><div className="pip pip-sky" />Loan Application Form</div>
                  <div className="mbadge">Real LR Scoring</div>
                </div>
                <div style={{fontSize:'13px',color:'var(--text2)',marginBottom:'20px'}}>Fill your details. The risk engine uses the actual trained logistic regression model to assess your default probability.</div>
                
                <div className="form-grid">
                  <div className="fg-sec"><div className="fg-sec-dot" />Personal Information</div>
                  <div>
                    <div className="flab">Age</div>
                    <input type="number" className="finput" value={formData.age} onChange={e => update('age', +e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <div className="flab">Credit Score</div>
                    <input type="number" className="finput" value={formData.credit} onChange={e => update('credit', +e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <div className="flab">Education Level</div>
                    <select className="fselect" value={formData.edu} onChange={e => update('edu', e.target.value)} disabled={isReadOnly}>
                      <option value="hs">High School</option><option value="bach">Bachelor's</option><option value="mast">Master's</option><option value="phd">PhD</option>
                    </select>
                  </div>
                  <div>
                    <div className="flab">Marital Status</div>
                    <select className="fselect" value={formData.marital} onChange={e => update('marital', e.target.value)} disabled={isReadOnly}>
                      <option value="single">Single</option><option value="married">Married</option><option value="divorced">Divorced</option>
                    </select>
                  </div>
                  <div>
                    <div className="flab">State / Region</div>
                    <select className="fselect" value={formData.state} onChange={e => update('state', e.target.value)} disabled={isReadOnly}>
                      <option value="">Select State / UT…</option>
                      <optgroup label="States">
                        <option value="AP">Andhra Pradesh</option>
                        <option value="AR">Arunachal Pradesh</option>
                        <option value="AS">Assam</option>
                        <option value="BR">Bihar</option>
                        <option value="CG">Chhattisgarh</option>
                        <option value="GA">Goa</option>
                        <option value="GJ">Gujarat</option>
                        <option value="HR">Haryana</option>
                        <option value="HP">Himachal Pradesh</option>
                        <option value="JH">Jharkhand</option>
                        <option value="KA">Karnataka</option>
                        <option value="KL">Kerala</option>
                        <option value="MP">Madhya Pradesh</option>
                        <option value="MH">Maharashtra</option>
                        <option value="MN">Manipur</option>
                        <option value="ML">Meghalaya</option>
                        <option value="MZ">Mizoram</option>
                        <option value="NL">Nagaland</option>
                        <option value="OD">Odisha</option>
                        <option value="PB">Punjab</option>
                        <option value="RJ">Rajasthan</option>
                        <option value="SK">Sikkim</option>
                        <option value="TN">Tamil Nadu</option>
                        <option value="TS">Telangana</option>
                        <option value="TR">Tripura</option>
                        <option value="UP">Uttar Pradesh</option>
                        <option value="UK">Uttarakhand</option>
                        <option value="WB">West Bengal</option>
                      </optgroup>
                      <optgroup label="Union Territories">
                        <option value="AN">Andaman &amp; Nicobar Islands</option>
                        <option value="CH">Chandigarh</option>
                        <option value="DN">Dadra &amp; Nagar Haveli and Daman &amp; Diu</option>
                        <option value="DL">Delhi (NCT)</option>
                        <option value="JK">Jammu &amp; Kashmir</option>
                        <option value="LA">Ladakh</option>
                        <option value="LD">Lakshadweep</option>
                        <option value="PY">Puducherry</option>
                      </optgroup>
                    </select>
                  </div>
                  <div>
                    <div className="flab">Annual Income (₹)</div>
                    <input type="number" className="finput" value={formData.income} onChange={e => update('income', +e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <div className="flab">Loan Amount (₹)</div>
                    <input type="number" className="finput" value={formData.loanAmt} onChange={e => update('loanAmt', +e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <div className="flab">DTI Ratio</div>
                    <input type="number" step="0.01" className="finput" value={formData.dti} onChange={e => update('dti', +e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <div className="flab">Credit Lines</div>
                    <input type="number" className="finput" value={formData.lines} onChange={e => update('lines', +e.target.value)} disabled={isReadOnly} />
                  </div>

                  <div className="fg-sec"><div className="fg-sec-dot" />Loan Requirement</div>
                  <div>
                    <div className="flab">Purpose <span className="combo-tag">+ Custom</span></div>
                    <div className="combo-field">
                      <select className="combo-select" value={formData.purpose} onChange={e => update('purpose', e.target.value)} disabled={isReadOnly}>
                        <option value="home">🏠 Home</option><option value="auto">🚗 Auto</option><option value="education">🎓 Education</option><option value="business">🏢 Business</option><option value="medical">🏥 Medical</option><option value="personal">👤 Personal Loan</option><option value="other">📦 Other</option><option value="custom">✏️ Write your own…</option>
                      </select>
                      <input 
                        className={`combo-manual ${formData.purpose === 'custom' ? 'show' : ''}`} 
                        placeholder="e.g. Wedding, Medical, Machinery…" 
                        value={formData.customPurpose}
                        onChange={e => update('customPurpose', e.target.value)}
                        disabled={isReadOnly}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flab">Term <span className="combo-tag">+ Custom</span></div>
                    <div className="combo-field">
                      <select className="combo-select" value={formData.term} onChange={e => update('term', e.target.value)} disabled={isReadOnly}>
                        <option value="12">12 months</option><option value="24">24 months</option><option value="36">36 months</option><option value="48">48 months</option><option value="60">60 months</option><option value="custom">✏️ Enter months manually…</option>
                      </select>
                      <input 
                        type="number"
                        className={`combo-manual ${formData.term === 'custom' ? 'show' : ''}`} 
                        placeholder="e.g. 18, 42, 72 months…" 
                        value={formData.customTerm}
                        onChange={e => update('customTerm', e.target.value)}
                        disabled={isReadOnly}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flab">Expected Interest Rate (% p.a.)</div>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="finput" 
                      placeholder="e.g. 10.5" 
                      value={formData.rate} 
                      onChange={e => update('rate', e.target.value)} 
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="fg-sec"><div className="fg-sec-dot" />Employment</div>
                  <div>
                    <div className="flab">Employment Type</div>
                    <select className="fselect" value={formData.empType} onChange={e => update('empType', e.target.value)} disabled={isReadOnly}>
                      <option value="full">Full-time</option><option value="part">Part-time</option><option value="self">Self-employed</option><option value="unemployed">Unemployed</option>
                    </select>
                  </div>
                  <div>
                    <div className="flab">Months Employed</div>
                    <input type="number" className="finput" value={formData.empl} onChange={e => update('empl', +e.target.value)} disabled={isReadOnly} />
                  </div>
                  <div>
                    <div className="flab">Job Changes (Last 5 Years)</div>
                    <input type="number" className="finput" value={formData.jobChanges} onChange={e => update('jobChanges', +e.target.value)} disabled={isReadOnly} />
                  </div>

                  <div className="fg-sec"><div className="fg-sec-dot" />Additional Flags</div>
                  <div>
                    <div className="flab">Has Mortgage?</div>
                    <div className="ftog">
                      <button className={`ftog-btn ${flags.mort === 'Y' ? 'on' : ''}`} onClick={() => tog('mort', 'Y')}>Yes</button>
                      <button className={`ftog-btn ${flags.mort === 'N' ? 'on' : ''}`} onClick={() => tog('mort', 'N')}>No</button>
                    </div>
                  </div>
                  <div>
                    <div className="flab">Has Dependents?</div>
                    <div className="ftog">
                      <button className={`ftog-btn ${flags.dep === 'Y' ? 'on' : ''}`} onClick={() => tog('dep', 'Y')}>Yes</button>
                      <button className={`ftog-btn ${flags.dep === 'N' ? 'on' : ''}`} onClick={() => tog('dep', 'N')}>No</button>
                    </div>
                  </div>
                  <div className="fg-full">
                    <div className="flab">Has Co-Signer?</div>
                    <div className="ftog">
                      <button className={`ftog-btn ${flags.co === 'Y' ? 'on' : ''}`} onClick={() => tog('co', 'Y')}>Yes</button>
                      <button className={`ftog-btn ${flags.co === 'N' ? 'on' : ''}`} onClick={() => tog('co', 'N')}>No</button>
                    </div>
                  </div>

                  <div className="fg-sec"><div className="fg-sec-dot" style={{background:'var(--rose)'}} />Existing Loan from Other Bank?</div>
                  <div className="fg-full">
                    <div className="flab">Active Loan at Another Bank?</div>
                    <div className="ftog">
                      <button className={`ftog-btn ${flags.extloan === 'Y' ? 'on' : ''}`} onClick={() => tog('extloan', 'Y')}>Yes</button>
                      <button className={`ftog-btn ${flags.extloan === 'N' ? 'on' : ''}`} onClick={() => tog('extloan', 'N')}>No</button>
                    </div>
                  </div>

                  {flags.extloan === 'Y' && (
                    <div style={{gridColumn:'1/-1',background:'rgba(232,84,117,0.06)',border:'1px solid rgba(232,84,117,0.18)',borderRadius:'12px',padding:'16px',marginTop:'4px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
                      <div style={{gridColumn:'1/-1',fontSize:'11px',color:'var(--rose)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.8px',marginBottom:'4px'}}>⚠️ This information affects your risk score — it increases your DTI and credit obligation burden</div>
                      <div>
                        <div className="flab">Outstanding Loan Amount (₹)</div>
                        <input type="number" className="finput" value={formData.extLoanAmt} onChange={e => update('extLoanAmt', +e.target.value)} disabled={isReadOnly} />
                      </div>
                      <div>
                        <div className="flab">Monthly EMI Being Paid (₹)</div>
                        <input type="number" className="finput" value={formData.extEmi} onChange={e => update('extEmi', +e.target.value)} disabled={isReadOnly} />
                      </div>
                      <div>
                        <div className="flab">Interest Rate (% p.a.)</div>
                        <input type="number" step="0.01" className="finput" placeholder="e.g. 10.5" value={formData.extRate || ''} onChange={e => update('extRate', e.target.value)} disabled={isReadOnly} />
                      </div>
                      <div>
                        <div className="flab">Bank Name <span className="combo-tag">+ Custom</span></div>
                        <div className="combo-field">
                          <select className="combo-select" value={formData.extBank} onChange={e => update('extBank', e.target.value)} disabled={isReadOnly}>
                            <option value="">Select bank...</option>
                            <option value="SBI">SBI</option>
                            <option value="HDFC Bank">HDFC Bank</option>
                            <option value="ICICI Bank">ICICI Bank</option>
                            <option value="Axis Bank">Axis Bank</option>
                            <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
                            <option value="PNB">Punjab National Bank</option>
                            <option value="Bank of Baroda">Bank of Baroda</option>
                            <option value="Canara Bank">Canara Bank</option>
                            <option value="Union Bank">Union Bank of India</option>
                            <option value="IDFC First Bank">IDFC First Bank</option>
                            <option value="IndusInd Bank">IndusInd Bank</option>
                            <option value="Yes Bank">Yes Bank</option>
                            <option value="custom">Enter manually...</option>
                          </select>
                          <input
                            className={`combo-manual ${formData.extBank === 'custom' ? 'show' : ''}`}
                            placeholder="Enter bank name..."
                            value={formData.extBankCustom || ''}
                            onChange={e => update('extBankCustom', e.target.value)}
                            disabled={isReadOnly}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flab">Loan Purpose <span className="combo-tag">+ Custom</span></div>
                        <div className="combo-field">
                          <select className="combo-select" value={formData.extLoanType} onChange={e => update('extLoanType', e.target.value)} disabled={isReadOnly}>
                            <option value="personal">Personal Loan</option>
                            <option value="home">Home Loan</option>
                            <option value="auto">Auto/Vehicle Loan</option>
                            <option value="education">Education Loan</option>
                            <option value="business">Business Loan</option>
                            <option value="gold">Gold Loan</option>
                            <option value="other">Other</option>
                            <option value="custom">Enter manually...</option>
                          </select>
                          <input
                            className={`combo-manual ${formData.extLoanType === 'custom' ? 'show' : ''}`}
                            placeholder="e.g. Agriculture Loan, LAP..."
                            value={formData.extLoanTypeCustom || ''}
                            onChange={e => update('extLoanTypeCustom', e.target.value)}
                          />
                        </div>
                      </div>
                      {(formData.extLoanAmt > 0 || formData.extEmi > 0) && (
                        <div style={{gridColumn:'1/-1',padding:'10px 14px',background:'rgba(201,151,60,0.08)',border:'1px solid rgba(201,151,60,0.18)',borderRadius:'9px',fontSize:'12px',color:'var(--text2)'}}>
                          <div style={{fontWeight:700,color:'var(--gold)',marginBottom:'6px'}}>📊 Live Risk Impact Preview</div>
                          <div style={{lineHeight:1.7}}>
                            <span style={{color:'var(--gold)'}}>● Existing EMI burden: <strong>₹{fmt(formData.extEmi)}/mo</strong> = {formData.income>0?((formData.extEmi/(formData.income/12))*100).toFixed(1):0}% of your monthly income</span><br/>
                            <span style={{color:'var(--text2)'}}>● DTI effectively increases by ~<strong>{formData.income>0?((formData.extEmi/(formData.income/12))).toFixed(2):0}</strong> — model penalises higher DTI</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isReadOnly && (
                    <div className="fg-full mt18">
                      <button className="btn-assess" onClick={handleSubmit}>
                        📤 Submit Loan Application
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* CONTAINER 2: RESULT (Shown in bpg-view-app) */}
              {page === 'bpg-view-app' && result && (
                  <div className="fade-in">
                    <div className="bstatus-hero" style={{ padding: '24px', borderRadius: '16px', marginBottom: '24px', background: result.level === 'low' ? 'linear-gradient(135deg, rgba(38,166,154,0.1) 0%, transparent 100%)' : result.level === 'med' ? 'linear-gradient(135deg, rgba(201,151,60,0.1) 0%, transparent 100%)' : 'linear-gradient(135deg, rgba(232,84,117,0.1) 0%, transparent 100%)' }}>
                      <div className="bsh-t" style={{ fontSize: '24px', marginBottom: '4px' }}>Assessment Result</div>
                      <div className="bsh-s" style={{ fontSize: '12px' }}>Risk analysis snapshot for this historical application.</div>
                      <div className="bsh-chips" style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span className={`bpill ${result.level==='low'?'bp-teal':result.level==='med'?'bp-gold':'bp-rose'}`} style={{ padding: '6px 14px', fontSize: '12px' }}>
                          {result.level==='low'?'✅ Approved':result.level==='med'?'⚠️ Under Review':'❌ High Risk'}
                        </span>
                        <span className="bpill bp-sky" style={{ padding: '6px 14px', fontSize: '12px' }}>
                          ₹{fmt(formData.loanAmt)} · {effectiveTerm} months · {displayPurpose}
                        </span>
                        <span className="mbadge" style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '20px', padding: '6px 14px', fontSize: '12px', fontWeight: 600 }}>
                          Risk: {result.pct}%
                        </span>
                      </div>
                    </div>

                    <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '18px' }}>
                      <div className="card glass">
                        <div className="ch"><div className="ct"><div className={`pip pip-${result.level==='low'?'teal':result.level==='med'?'gold':'rose'}`} />Risk Probability</div></div>
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                          <div style={{ fontFamily: "'Fraunces',serif", fontSize: '56px', fontWeight: 700, color: result.level === 'low' ? 'var(--teal)' : result.level === 'med' ? 'var(--gold)' : 'var(--rose)' }}>{result.pct}%</div>
                          <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Probability of Default</div>
                          <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg3)', margin: '18px 0', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${result.pct}%`, background: result.level === 'low' ? 'var(--teal)' : result.level === 'med' ? 'var(--gold)' : 'var(--rose)' }} />
                          </div>
                        </div>
                      </div>

                      <div className="card glass">
                        <div className="ch"><div className="ct"><div className="pip pip-sky" />Monthly Installment</div></div>
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                          <div style={{ fontFamily: "'Fraunces',serif", fontSize: '42px', fontWeight: 700, color: 'var(--gold)' }}>₹{fmt(result.sched.emi)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px' }}>Monthly EMI for {effectiveTerm} months</div>
                        </div>
                      </div>

                      <div className="card glass">
                        <div className="ch"><div className="ct"><div className="pip pip-sky" />Repayment Summary</div></div>
                        <div style={{ padding: '10px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ color: 'var(--text2)' }}>Principal Amount</span>
                            <span style={{ fontWeight: 600 }}>₹{fmt(formData.loanAmt)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ color: 'var(--text2)' }}>Total Interest</span>
                            <span style={{ fontWeight: 600, color: 'var(--rose)' }}>₹{fmt(result.sched.tI)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700 }}>
                            <span style={{ color: 'var(--text)' }}>Total Payable</span>
                            <span style={{ color: 'var(--teal)' }}>₹{fmt(result.sched.tPay)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {page === 'bpg-status' && (
            <div className="fade-in">
              {!result ? (
                <div style={{textAlign:'center',padding:'60px',color:'var(--text3)'}}>
                  <div style={{fontSize:'44px',marginBottom:'14px',animation:'floatBob 3s ease-in-out infinite'}}>📋</div>
                  <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,color:'var(--text)',marginBottom:'8px'}}>No application submitted yet</div>
                  <div style={{fontSize:'13px'}}>Go to <strong>Submit Details</strong> to fill your loan application.</div>
                </div>
              ) : (
                <div>
                  <div className="bstatus-hero">
                    <div className="bsh-t">Application Submitted</div>
                    <div className="bsh-s">Assessed by GroundZero LR Model · ROC-AUC 0.760 · {new Date().toLocaleString()}</div>
                    <div className="bsh-chips">
                      <span className={`bpill ${result.level==='low'?'bp-teal':result.level==='med'?'bp-gold':'bp-rose'}`}>{result.level==='low'?'✅ Likely Approved':result.level==='med'?'⚠️ Under Review':'❌ High Risk'}</span>
                        <span className="bpill bp-sky">₹{fmt(formData.loanAmt)} · {effectiveTerm} months · {displayPurpose}</span>
                      <span className="mbadge">σ(wᵀx+b) = {result.pct}%</span>
                      {result.hasExtLoan && <span className="bpill bp-rose">⚠️ Existing Loan Factored</span>}
                    </div>
                  </div>

                  <div className="g2 mb18">
                    <div className="card">
                      <div className="ch"><div className="ct"><div className={`pip pip-${result.level==='low'?'teal':result.level==='med'?'gold':'rose'}`} />Your Risk Score</div></div>
                      <div style={{textAlign:'center',padding:'16px 0'}}>
                        <div style={{fontFamily:"'Fraunces',serif",fontSize:'64px',fontWeight:700,lineHeight:1,color:result.level==='low'?'var(--teal)':result.level==='med'?'var(--gold)':'var(--rose)'}}>{result.pct}%</div>
                        <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginTop:'6px'}}>Default Probability</div>
                        <div style={{height:'8px',borderRadius:'4px',background:'var(--bg3)',margin:'14px 0 10px',overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${result.pct}%`,background:result.level==='low'?'linear-gradient(90deg,var(--teal),var(--teal2))':result.level==='med'?'linear-gradient(90deg,var(--gold),var(--gold2))':'linear-gradient(90deg,var(--rose),var(--rose2))'}} />
                        </div>
                        <div style={{fontSize:'12px',color:'var(--text2)'}}>Category: <strong style={{color:result.level==='low'?'var(--teal)':result.level==='med'?'var(--gold)':'var(--rose)'}}>{result.level==='low'?'Low (<30%)':result.level==='med'?'Medium (30-60%)':'High (>60%)'}</strong></div>
                        {result.hasExtLoan && result.riskDelta > 0 && <div style={{marginTop:'8px',fontSize:'11px',color:'var(--rose)'}}>▲ {result.riskDelta}pp higher due to existing loan</div>}
                      </div>
                    </div>
                    <div className="card">
                      <div className="ch"><div className="ct"><div className="pip pip-sky" />Monthly EMI</div></div>
                      <div style={{textAlign:'center',padding:'12px 0'}}>
                        <div style={{fontFamily:"'Fraunces',serif",fontSize:'48px',fontWeight:700,color:'var(--gold)'}}>₹{fmt(result.sched.emi)}</div>
                        <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'6px'}}>per month for {effectiveTerm} months</div>
                        
                        {(() => {
                          const moIncome = formData.income / 12 || 1;
                          const ratio = ((result.sched.emi + (result.extEmi||0)) / moIncome * 100).toFixed(1);
                          const isHigh = ratio > 50;
                          return (
                            <div style={{marginTop:'14px',fontSize:'12px',fontWeight:600,color:isHigh?'var(--rose)':'var(--teal)'}}>
                              {ratio}% of monthly income {isHigh ? '⚠️ High' : ''}
                            </div>
                          );
                        })()}

                        {result.hasExtLoan && result.extEmi > 0 && <div style={{marginTop:'8px',fontSize:'11px',padding:'6px 10px',borderRadius:'7px',background:'rgba(232,84,117,0.08)',color:'var(--rose)'}}>+ ₹{fmt(result.extEmi)}/mo existing EMI → Total: ₹{fmt(result.sched.emi+result.extEmi)}/mo</div>}
                      </div>
                    </div>
                  </div>

                  {/* Repayment Breakdown */}
                  <div className="card mb18">
                    <div className="ch"><div className="ct"><div className="pip pip-sky" />Your Repayment Breakdown</div></div>
                    
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'14px',marginTop:'8px'}}>
                      <div style={{background:'var(--bg3)',padding:'16px',borderRadius:'12px',textAlign:'center'}}>
                        <div style={{fontFamily:"'Fraunces',serif",fontSize:'24px',fontWeight:700,color:'var(--teal)'}}>₹{fmt(formData.loanAmt)}</div>
                        <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginTop:'4px'}}>Principal</div>
                      </div>
                      <div style={{background:'var(--bg3)',padding:'16px',borderRadius:'12px',textAlign:'center'}}>
                        <div style={{fontFamily:"'Fraunces',serif",fontSize:'24px',fontWeight:700,color:'var(--rose)'}}>₹{fmt(result.sched.tI)}</div>
                        <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginTop:'4px'}}>Total Interest</div>
                      </div>
                      <div style={{background:'var(--bg3)',padding:'16px',borderRadius:'12px',textAlign:'center'}}>
                        <div style={{fontFamily:"'Fraunces',serif",fontSize:'24px',fontWeight:700,color:'var(--gold)'}}>₹{fmt(result.sched.tPay)}</div>
                        <div style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginTop:'4px'}}>Total Repayment</div>
                      </div>
                    </div>

                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'18px',fontSize:'11px',color:'var(--text2)'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'4px'}}><div style={{width:'8px',height:'8px',background:'var(--sky)',borderRadius:'2px'}}></div> Principal {Math.round((formData.loanAmt / result.sched.tPay) * 100)}%</div>
                      <div style={{display:'flex',alignItems:'center',gap:'4px'}}><div style={{width:'8px',height:'8px',background:'var(--rose)',borderRadius:'2px'}}></div> Interest {Math.round((result.sched.tI / result.sched.tPay) * 100)}%</div>
                    </div>
                    
                    <div style={{display:'flex',height:'12px',borderRadius:'6px',overflow:'hidden',marginTop:'8px'}}>
                      <div style={{width:`${(formData.loanAmt / result.sched.tPay) * 100}%`,background:'var(--sky)'}}></div>
                      <div style={{width:`${(result.sched.tI / result.sched.tPay) * 100}%`,background:'var(--rose)'}}></div>
                    </div>

                    <div style={{marginTop:'24px'}}>
                      <div className="br-row" style={{display:'flex',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:'12px',marginBottom:'12px'}}><span style={{color:'var(--text2)'}}>Rate (indicative)</span><span>{formData.rate}% p.a.</span></div>
                      <div className="br-row" style={{display:'flex',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:'12px',marginBottom:'12px'}}><span style={{color:'var(--text2)'}}>Term</span><span>{effectiveTerm} months ({displayPurpose})</span></div>
                      <div className="br-row" style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'var(--text2)'}}>Loan / Annual Income</span><span>{formData.income > 0 ? (formData.loanAmt / formData.income).toFixed(2) : 0}x</span></div>
                    </div>
                  </div>

                  {/* Amortization Schedule */}
                  <div className="card">
                    <div className="ch" style={{justifyContent:'space-between'}}>
                      <div className="ct"><div className="pip pip-sky" />Full Amortization Schedule</div>
                      <div style={{fontSize:'12px',color:'var(--text3)'}}>Month-by-month repayment</div>
                    </div>
                    <div style={{overflowX:'auto',marginTop:'14px'}}>
                      <table className="tbl" style={{width:'100%',minWidth:'600px',borderCollapse:'collapse'}}>
                        <thead>
                          <tr>
                            <th style={{textAlign:'left',fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',paddingBottom:'12px'}}>MONTH</th>
                            <th style={{textAlign:'right',fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',paddingBottom:'12px'}}>EMI</th>
                            <th style={{textAlign:'right',fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',paddingBottom:'12px'}}>PRINCIPAL</th>
                            <th style={{textAlign:'right',fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',paddingBottom:'12px'}}>INTEREST</th>
                            <th style={{textAlign:'right',fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',paddingBottom:'12px'}}>BALANCE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.sched.rows.slice(0, expandSched ? undefined : 12).map((r, i) => (
                            <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                              <td style={{padding:'12px 0',color:'var(--text2)',fontSize:'12px'}}>Mo {r.m}</td>
                              <td style={{padding:'12px 0',textAlign:'right',fontWeight:600}}>₹{fmt(r.emi)}</td>
                              <td style={{padding:'12px 0',textAlign:'right',color:'var(--text2)'}}>₹{fmt(r.p)}</td>
                              <td style={{padding:'12px 0',textAlign:'right',color:'var(--rose)'}}>₹{fmt(r.i)}</td>
                              <td style={{padding:'12px 0',textAlign:'right',color:'var(--gold)'}}>₹{fmt(r.bal)}</td>
                            </tr>
                          ))}
                          {!expandSched && result.sched.rows.length > 12 && (
                            <tr style={{borderTop:'1px solid var(--border)'}}>
                              <td colSpan="5" style={{textAlign:'center',padding:'16px'}}>
                                <button 
                                  onClick={() => setExpandSched(true)}
                                  style={{background:'none',border:'none',color:'var(--sky)',fontSize:'12px',fontStyle:'italic',cursor:'pointer',textDecoration:'underline'}}
                                >
                                  ... and {result.sched.rows.length - 12} more months.
                                </button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {page === 'bpg-stocks' && (
             <div className="fade-in">
                <div className="bstatus-hero" style={{background:'linear-gradient(135deg,rgba(56,201,176,0.06),rgba(139,114,240,0.06))',borderColor:'rgba(139,114,240,0.18)',marginBottom:'20px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'14px'}}>
                    <div>
                      <div className="bsh-t">📈 Stock & Crypto Suggestions</div>
                      <div className="bsh-s">AI-powered picks tailored to your risk profile — updated live from market data</div>
                      <div className="bsh-chips" style={{marginTop:'10px'}}>
                        <span className="mbadge" style={{background:'rgba(139,114,240,0.1)',color:'var(--violet)',borderColor:'rgba(139,114,240,0.22)'}}>NSE / BSE Listed</span>
                        <span className="mbadge" style={{background:'rgba(56,201,176,0.1)',color:'var(--teal)',borderColor:'rgba(56,201,176,0.22)'}}>Real-time Crypto</span>
                        <span className="mbadge" style={{background:'rgba(201,151,60,0.1)',color:'var(--gold)',borderColor:'rgba(201,151,60,0.22)'}}>AI Analysis</span>
                      </div>
                    </div>
                    <button style={{padding:'10px 22px',borderRadius:'10px',border:'1.5px solid var(--violet)',background:'rgba(139,114,240,0.1)',color:'var(--violet)',fontFamily:"'Outfit',sans-serif",fontSize:'13px',fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:'8px'}}>
                      🔄 Refresh Picks
                    </button>
                  </div>
                </div>
                
                <div className="kpi-row" style={{marginBottom:'20px'}}>
                  <div className="kpi violet fade-up fade-up-d1" style={{'--violet-kpi':'var(--violet)'}}>
                    <div className="kpi-lbl">BITCOIN (Live)</div>
                    <div className="kpi-val" style={{color:'var(--violet)',fontSize:'24px'}}>
                      {liveData.loading ? '...' : liveData.btc ? `₹${fmt(liveData.btc.inr)}` : '₹55,42,100'}
                    </div>
                    <div className="kpi-sub">
                      {liveData.btc && liveData.btc.inr_24h_change >= 0 ? <span className="up">▲ {liveData.btc.inr_24h_change.toFixed(2)}% today</span> : 
                       liveData.btc && liveData.btc.inr_24h_change < 0 ? <span className="down" style={{color:'var(--rose)'}}>▼ {Math.abs(liveData.btc.inr_24h_change).toFixed(2)}% today</span> :
                       <span className="up">▲ 1.2% today</span>}
                    </div>
                  </div>
                  <div className="kpi teal fade-up fade-up-d2">
                    <div className="kpi-lbl">SENSEX</div><div className="kpi-val" style={{color:'var(--teal)',fontSize:'24px'}}>79,841</div><div className="kpi-sub"><span className="up">▲ 0.57% today</span></div>
                  </div>
                  <div className="kpi gold fade-up fade-up-d3">
                    <div className="kpi-lbl">SUGGESTED PICKS</div><div className="kpi-val" style={{fontSize:'24px'}}>6</div><div className="kpi-sub">Based on your risk profile</div>
                  </div>
                  <div className="kpi sky fade-up fade-up-d4">
                    <div className="kpi-lbl">AVG. ANALYST RATING</div><div className="kpi-val" style={{color:'var(--sky)',fontSize:'24px'}}>6/8 Buy</div><div className="kpi-sub">Across all picks</div>
                  </div>
                </div>

                {!result ? (
                  <div className="card fade-up mb18" style={{textAlign:'center',padding:'40px',color:'var(--text2)'}}>
                    <div style={{fontSize:'32px',marginBottom:'12px'}}>📊</div>
                    <div style={{fontSize:'16px',fontWeight:700,color:'var(--text)'}}>Submit your application first</div>
                    <div style={{fontSize:'13px',marginTop:'8px'}}>We need to assess your risk profile before suggesting personalized investments.</div>
                  </div>
                ) : (
                  <div style={{display:'grid',gridTemplateColumns:'minmax(0,2fr) minmax(0,1fr)',gap:'20px'}}>
                    {/* Left Column: Live Stock Picks */}
                    <div>
                      <div className="card fade-up">
                        <div className="ch" style={{justifyContent:'space-between'}}>
                          <div className="ct"><div className="pip pip-violet" />Live Market Picks</div>
                          <div style={{fontSize:'11px',background:'rgba(139,114,240,0.1)',color:'var(--violet)',padding:'4px 10px',borderRadius:'6px',fontWeight:600}}>Updated {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                        </div>
                        
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:'14px',marginTop:'14px'}}>
                          {/* Crypto Card */}
                          <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px',background:'var(--bg)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                              <div>
                                <div style={{fontWeight:700,fontSize:'15px',color:'var(--text)'}}>BTC/INR</div>
                                <div style={{fontSize:'11px',color:'var(--text3)'}}>Bitcoin (Crypto)</div>
                              </div>
                              <span style={{background:'rgba(56,201,176,0.1)',color:'var(--teal)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:700}}>✅ BUY</span>
                            </div>
                            <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,marginBottom:'4px'}}>
                              {liveData.loading ? '...' : liveData.btc ? `₹${fmt(liveData.btc.inr)}` : '₹55,42,100'}
                            </div>
                            <div style={{fontSize:'12px',fontWeight:600,color:liveData.btc && liveData.btc.inr_24h_change < 0 ? 'var(--rose)' : 'var(--teal)'}}>
                              {liveData.btc && liveData.btc.inr_24h_change < 0 ? '▼' : '▲'} {liveData.btc ? Math.abs(liveData.btc.inr_24h_change).toFixed(2) : '1.2'}% today
                            </div>
                            <div style={{height:'1px',background:'var(--border)',margin:'12px 0'}}></div>
                            <div style={{fontSize:'11px',color:'var(--text2)',lineHeight:'1.5',marginBottom:'12px'}}>
                              High risk, high reward digital asset. Strong momentum driven by institutional adoption. Perfect for your low-risk credit profile as a speculative play.
                            </div>
                            <div style={{display:'inline-block',background:'var(--bg3)',padding:'3px 8px',borderRadius:'4px',fontSize:'10px',color:'var(--sky)'}}>Crypto</div>
                          </div>

                          <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px',background:'var(--bg)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                              <div>
                                <div style={{fontWeight:700,fontSize:'15px',color:'var(--text)'}}>RELIANCE</div>
                                <div style={{fontSize:'11px',color:'var(--text3)'}}>Reliance Industries</div>
                              </div>
                              <span style={{background:'rgba(56,201,176,0.1)',color:'var(--teal)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:700}}>✅ BUY</span>
                            </div>
                            <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,marginBottom:'4px'}}>₹2,941</div>
                            <div style={{fontSize:'12px',fontWeight:600,color:'var(--teal)'}}>▲ 0.82% today</div>
                            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'8px',display:'flex',justifyContent:'space-between'}}><span>52W High (est.)</span><span>₹3,588</span></div>
                            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px',display:'flex',justifyContent:'space-between'}}><span>52W Low (est.)</span><span>₹2,294</span></div>
                            <div style={{height:'1px',background:'var(--border)',margin:'12px 0'}}></div>
                            <div style={{fontSize:'11px',color:'var(--text2)',lineHeight:'1.5',marginBottom:'12px'}}>
                              Diversified conglomerate with strong Jio & retail tailwinds. Consistent dividend payer.
                            </div>
                            <div style={{display:'inline-block',background:'var(--bg3)',padding:'3px 8px',borderRadius:'4px',fontSize:'10px',color:'var(--sky)'}}>Energy</div>
                          </div>

                          <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px',background:'var(--bg)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                              <div>
                                <div style={{fontWeight:700,fontSize:'15px',color:'var(--text)'}}>TCS</div>
                                <div style={{fontSize:'11px',color:'var(--text3)'}}>Tata Consultancy Services</div>
                              </div>
                              <span style={{background:'rgba(56,201,176,0.1)',color:'var(--teal)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:700}}>✅ BUY</span>
                            </div>
                            <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,marginBottom:'4px'}}>₹3,456</div>
                            <div style={{fontSize:'12px',fontWeight:600,color:'var(--rose)'}}>▼ 0.41% today</div>
                            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'8px',display:'flex',justifyContent:'space-between'}}><span>52W High (est.)</span><span>₹4,216</span></div>
                            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px',display:'flex',justifyContent:'space-between'}}><span>52W Low (est.)</span><span>₹2,696</span></div>
                            <div style={{height:'1px',background:'var(--border)',margin:'12px 0'}}></div>
                            <div style={{fontSize:'11px',color:'var(--text2)',lineHeight:'1.5',marginBottom:'12px'}}>
                              India's largest IT firm. Consistent buybacks, high ROE, and stable dollar revenues.
                            </div>
                            <div style={{display:'inline-block',background:'var(--bg3)',padding:'3px 8px',borderRadius:'4px',fontSize:'10px',color:'var(--sky)'}}>IT</div>
                          </div>

                          <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px',background:'var(--bg)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                              <div>
                                <div style={{fontWeight:700,fontSize:'15px',color:'var(--text)'}}>HDFC BANK</div>
                                <div style={{fontSize:'11px',color:'var(--text3)'}}>HDFC Bank</div>
                              </div>
                              <span style={{background:'rgba(56,201,176,0.1)',color:'var(--teal)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:700}}>✅ BUY</span>
                            </div>
                            <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,marginBottom:'4px'}}>₹1,621</div>
                            <div style={{fontSize:'12px',fontWeight:600,color:'var(--teal)'}}>▲ 1.15% today</div>
                            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'8px',display:'flex',justifyContent:'space-between'}}><span>52W High (est.)</span><span>₹1,978</span></div>
                            <div style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px',display:'flex',justifyContent:'space-between'}}><span>52W Low (est.)</span><span>₹1,264</span></div>
                            <div style={{height:'1px',background:'var(--border)',margin:'12px 0'}}></div>
                            <div style={{fontSize:'11px',color:'var(--text2)',lineHeight:'1.5',marginBottom:'12px'}}>
                              Best-in-class Indian private bank. Strong loan growth, low NPA, improving margins.
                            </div>
                            <div style={{display:'inline-block',background:'var(--bg3)',padding:'3px 8px',borderRadius:'4px',fontSize:'10px',color:'var(--sky)'}}>Banking</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: AI Analysis & Allocation */}
                    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
                      <div className="card fade-up fade-up-d1">
                        <div className="ch" style={{justifyContent:'space-between'}}>
                          <div className="ct"><div className="pip pip-teal" />AI Market Analysis</div>
                          <span className="mbadge" style={{background:'rgba(201,151,60,0.1)',color:'var(--gold)'}}>Claude AI</span>
                        </div>
                        <div style={{fontSize:'13px',color:'var(--text2)',lineHeight:'1.7',marginTop:'8px'}}>
                          Indian markets are showing resilience with IT and banking sectors leading gains. <strong style={{color:'var(--teal)'}}>ICICI Bank</strong> offers compelling risk-reward with ROE expansion and retail credit growth. Watch the <strong style={{color:'var(--gold)'}}>Pharma sector</strong> as global generics demand recovers. Note: Markets are subject to volatility — diversify across sectors and maintain a 3-year+ horizon.
                        </div>
                        <div style={{background:'var(--bg)',padding:'10px',borderRadius:'8px',fontSize:'11px',color:'var(--text3)',marginTop:'14px',display:'flex',alignItems:'center',gap:'8px'}}>
                          <span>⚡</span> Live analysis generated based on your {result.level === 'low' ? 'Low' : result.level === 'med' ? 'Medium' : 'High'} risk profile.
                        </div>
                      </div>

                      <div className="card fade-up fade-up-d2">
                        <div className="ch"><div className="ct"><div className="pip pip-gold" />Portfolio Allocation</div></div>
                        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'12px'}}>
                          <div>
                            <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'var(--text2)',marginBottom:'4px'}}><span>Large Cap Equity</span><span>55%</span></div>
                            <div style={{height:'6px',background:'var(--bg3)',borderRadius:'3px',overflow:'hidden'}}><div style={{width:'55%',height:'100%',background:'var(--sky)'}}></div></div>
                          </div>
                          <div>
                            <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'var(--text2)',marginBottom:'4px'}}><span>NBFC / Banking</span><span>25%</span></div>
                            <div style={{height:'6px',background:'var(--bg3)',borderRadius:'3px',overflow:'hidden'}}><div style={{width:'25%',height:'100%',background:'var(--teal)'}}></div></div>
                          </div>
                          <div>
                            <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'var(--text2)',marginBottom:'4px'}}><span>Pharma</span><span>17%</span></div>
                            <div style={{height:'6px',background:'var(--bg3)',borderRadius:'3px',overflow:'hidden'}}><div style={{width:'17%',height:'100%',background:'var(--violet)'}}></div></div>
                          </div>
                          <div>
                            <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'var(--text2)',marginBottom:'4px'}}><span>Crypto / Alt</span><span>3%</span></div>
                            <div style={{height:'6px',background:'var(--bg3)',borderRadius:'3px',overflow:'hidden'}}><div style={{width:'3%',height:'100%',background:'var(--gold)'}}></div></div>
                          </div>
                        </div>
                      </div>

                      <div className="card fade-up fade-up-d3" style={{background:'linear-gradient(135deg,rgba(232,84,117,0.04),rgba(201,151,60,0.04))',borderColor:'rgba(201,151,60,0.15)'}}>
                        <div style={{fontSize:'11px',fontWeight:700,color:'var(--gold)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>⚠️ Disclaimer</div>
                        <div style={{fontSize:'11px',color:'var(--text3)',lineHeight:'1.6'}}>Stock and Crypto suggestions are for informational purposes only and do not constitute financial advice. Past performance is not indicative of future results. Always consult a SEBI-registered advisor before investing.</div>
                      </div>
                    </div>
                  </div>
                )}
             </div>
          )}

          {page === 'bpg-tips' && (
            <div className="fade-in">
              <div className="ct" style={{marginBottom:'24px',fontFamily:"'Fraunces',serif",fontSize:'20px',fontWeight:700,color:'var(--text)'}}><div className="pip pip-teal" />How to Improve Your Loan Eligibility</div>
              
              <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
                <div style={{display:'flex',gap:'16px',alignItems:'center',background:'var(--bg)',border:'1px solid var(--border)',padding:'20px',borderRadius:'16px'}}>
                  <div style={{background:'var(--bg3)',width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'12px',fontSize:'20px',boxShadow:'0 2px 8px rgba(0,0,0,0.05)',flexShrink:0}}>💳</div>
                  <div>
                    <div style={{fontWeight:700,color:'var(--text)',marginBottom:'4px',fontSize:'15px'}}>Credit Score: Aim for 700+</div>
                    <div style={{color:'var(--text2)',fontSize:'13px',lineHeight:'1.5'}}>Model coef: −0.121. Credit score 700–800 default rate: 10.4% vs 13.3% for 300–400. Pay EMIs on time, keep utilization below 30%.</div>
                  </div>
                </div>

                <div style={{display:'flex',gap:'16px',alignItems:'center',background:'var(--bg)',border:'1px solid var(--border)',padding:'20px',borderRadius:'16px'}}>
                  <div style={{background:'var(--bg3)',width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'12px',fontSize:'20px',boxShadow:'0 2px 8px rgba(0,0,0,0.05)',flexShrink:0}}>📊</div>
                  <div>
                    <div style={{fontWeight:700,color:'var(--text)',marginBottom:'4px',fontSize:'15px'}}>Loan/Income Ratio is #1 Predictor</div>
                    <div style={{color:'var(--text2)',fontSize:'13px',lineHeight:'1.5'}}>Loan_Income_Ratio coef: +0.470. Keep loan amount below 1.5× your annual income for best results with this model.</div>
                  </div>
                </div>

                <div style={{display:'flex',gap:'16px',alignItems:'center',background:'var(--bg)',border:'1px solid var(--border)',padding:'20px',borderRadius:'16px'}}>
                  <div style={{background:'var(--bg3)',width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'12px',fontSize:'20px',boxShadow:'0 2px 8px rgba(0,0,0,0.05)',flexShrink:0}}>📉</div>
                  <div>
                    <div style={{fontWeight:700,color:'var(--text)',marginBottom:'4px',fontSize:'15px'}}>Interest Rate is #2 Risk Driver</div>
                    <div style={{color:'var(--text2)',fontSize:'13px',lineHeight:'1.5'}}>InterestRate coef: +0.459. Negotiate for lower rates — even 1% less can noticeably reduce your default probability score.</div>
                  </div>
                </div>

                <div style={{display:'flex',gap:'16px',alignItems:'center',background:'var(--bg)',border:'1px solid var(--border)',padding:'20px',borderRadius:'16px'}}>
                  <div style={{background:'var(--bg3)',width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'12px',fontSize:'20px',boxShadow:'0 2px 8px rgba(0,0,0,0.05)',flexShrink:0}}>💼</div>
                  <div>
                    <div style={{fontWeight:700,color:'var(--text)',marginBottom:'4px',fontSize:'15px'}}>Employment Tenure Matters Most</div>
                    <div style={{color:'var(--text2)',fontSize:'13px',lineHeight:'1.5'}}>MonthsEmployed coef: -0.339. Avoid job changes within 6 months of application. The model rewards 48+ months of tenure.</div>
                  </div>
                </div>

                <div style={{display:'flex',gap:'16px',alignItems:'center',background:'var(--bg)',border:'1px solid var(--border)',padding:'20px',borderRadius:'16px'}}>
                  <div style={{background:'var(--bg3)',width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'12px',fontSize:'20px',boxShadow:'0 2px 8px rgba(0,0,0,0.05)',flexShrink:0}}>🤝</div>
                  <div>
                    <div style={{fontWeight:700,color:'var(--text)',marginBottom:'4px',fontSize:'15px'}}>Co-Signer Helps Significantly</div>
                    <div style={{color:'var(--text2)',fontSize:'13px',lineHeight:'1.5'}}>HasCoSigner_Yes coef: -0.142. Arrange a co-signer with 720+ credit score and stable full-time income to reduce your risk score.</div>
                  </div>
                </div>

                <div style={{display:'flex',gap:'16px',alignItems:'center',background:'var(--bg)',border:'1px solid var(--border)',padding:'20px',borderRadius:'16px'}}>
                  <div style={{background:'var(--bg3)',width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'12px',fontSize:'20px',boxShadow:'0 2px 8px rgba(0,0,0,0.05)',flexShrink:0}}>🏠</div>
                  <div>
                    <div style={{fontWeight:700,color:'var(--text)',marginBottom:'4px',fontSize:'15px'}}>Purpose: Home Loans are Safest</div>
                    <div style={{color:'var(--text2)',fontSize:'13px',lineHeight:'1.5'}}>LoanPurpose_Home coef: -0.078. Home loans have the lowest default rate (10.2%). Business loans carry the highest risk coefficient.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {page === 'bpg-history' && (
            <div className="fade-in">
              <div className="ct" style={{marginBottom:'24px',fontFamily:"'Fraunces',serif",fontSize:'20px',fontWeight:700,color:'var(--text)'}}><div className="pip pip-sky" />Application History</div>
              <div className="card glass">
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                    <thead>
                      <tr style={{borderBottom:'1px solid var(--border)',textAlign:'left'}}>
                        <th style={{padding:'12px',color:'var(--text2)'}}>Date</th>
                        <th style={{padding:'12px',color:'var(--text2)'}}>Amount</th>
                        <th style={{padding:'12px',color:'var(--text2)'}}>Purpose</th>
                        <th style={{padding:'12px',color:'var(--text2)'}}>Term</th>
                        <th style={{padding:'12px',color:'var(--text2)'}}>Result</th>
                        <th style={{padding:'12px',color:'var(--text2)'}}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(myApps) ? myApps : []).map((a, i) => (
                        <tr key={i} style={{borderBottom:'1px solid var(--border)'}}>
                          <td style={{padding:'12px'}}>{new Date(a.created_at).toLocaleDateString()}</td>
                          <td style={{padding:'12px',fontWeight:700}}>₹{fmt(a.loan_amount)}</td>
                          <td style={{padding:'12px'}}>{a.loan_purpose}</td>
                          <td style={{padding:'12px'}}>{a.term} mo</td>
                          <td style={{padding:'12px'}}>
                            <span className={`bpill ${a.risk_category?.toLowerCase()==='low'?'bp-teal':a.risk_category?.toLowerCase()==='medium'?'bp-gold':'bp-rose'}`}>
                              {a.risk_category || 'Unknown'} Risk
                            </span>
                          </td>
                          <td style={{padding:'12px'}}>
                            <button onClick={() => handleViewApp(a)} style={{background:'var(--bg3)',border:'1px solid var(--border)',padding:'4px 12px',borderRadius:'6px',fontSize:'11px',cursor:'pointer'}}>View Details</button>
                          </td>
                        </tr>
                      ))}
                      {myApps.length === 0 && (
                        <tr><td colSpan="6" style={{padding:'40px',textAlign:'center',color:'var(--text3)'}}>No previous applications found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <button className="ai-fab" onClick={() => setIsAiOpen(!isAiOpen)}>
        <span>🤖</span>
      </button>
      <ArthaAI isOpen={isAiOpen} onClose={() => setIsAiOpen(false)} />
    </div>
  );
}
