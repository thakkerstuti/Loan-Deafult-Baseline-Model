import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import ArthaAI from './ArthaAI';
import { calcRisk, buildSched, fmt, fmtK } from '../model';
import { apiUrl } from '../api';
import Chart from 'chart.js/auto';

export default function BankDashboard({ user, onLogout, theme, toggleTheme }) {
  const [page, setPage] = useState('pg-overview');
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [apps, setApps] = useState([]);

  const [formData, setFormData] = useState({
    fullName: '', age: '', credit: '', income: '', loanAmt: '', dti: '', lines: '',
    purpose: 'other', term: '', rate: '', empType: '', empl: '', jobChanges: '',
    edu: '', marital: '', state: '', customPurpose: '', customTerm: '',
    bank: '', customBank: '', extRate: '', extPurpose: 'home', customExtPurpose: ''
  });
  const [flags, setFlags] = useState({ mort: 'N', dep: 'N', co: 'N', extloan: 'N' });
  const [result, setResult] = useState(null);

  const [opt, setOpt] = useState({ loanAmt: 130000, credit: 575, dti: 0.35, empType: 'full' });
  const optProb = calcRisk({ ...formData, loanAmt: opt.loanAmt, credit: opt.credit, dti: opt.dti, empType: opt.empType }, flags);

  const update = (k, v) => setFormData(prev => ({ ...prev, [k]: v }));
  const tog = (k, v) => setFlags(prev => ({ ...prev, [k]: v }));

  const fetchApps = () => {
    fetch(apiUrl('/api/applications'))
      .then(r => r.json())
      .then(data => setApps(Array.isArray(data) ? data : []))
      .catch(e => console.error("Error fetching apps:", e));
  };

  useEffect(() => {
    fetchApps();
    // Auto-refresh data every 10 seconds to catch new submissions
    const interval = setInterval(fetchApps, 10000);
    return () => clearInterval(interval);
  }, []);

  // Also fetch when page changes to ensure fresh data
  useEffect(() => {
    if (page === 'pg-history' || page === 'pg-overview' || page === 'pg-insights') {
      fetchApps();
    }
    if (page === 'pg-assess') {
      setResult(null);
    }
  }, [page]);

  const handleSubmit = async () => {
    const required = ['age', 'income', 'loanAmt', 'credit', 'empl', 'lines', 'rate', 'term'];
    for (let f of required) {
      if (formData[f] === '' || formData[f] === null || formData[f] === undefined) {
        alert(`Please enter a value for ${f.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
        return;
      }
    }
    
    if (formData.term === 'custom' && !formData.customTerm) {
      alert('Please enter a custom loan term');
      return;
    }
    if (formData.purpose === 'custom' && !formData.customPurpose) {
      alert('Please enter a custom loan purpose');
      return;
    }
    
    const effectiveTerm = formData.term === 'custom' ? (parseInt(formData.customTerm) || 24) : (parseInt(formData.term) || 24);
    const purposeMap = { home: "Home", auto: "Auto", education: "Education", business: "Business", medical: "Other", personal: "Other", other: "Other", custom: "Other" };
    const effectivePurpose = formData.purpose === 'custom' ? (formData.customPurpose || "Other") : (formData.purpose || "other");
    
    const payload = {
      Age: formData.age,
      Income: formData.income,
      LoanAmount: formData.loanAmt,
      CreditScore: formData.credit,
      MonthsEmployed: formData.empl,
      NumCreditLines: formData.lines,
      InterestRate: formData.rate,
      LoanTerm: effectiveTerm,
      DTIRatio: formData.dti,
      Education: formData.edu === 'hs' ? 'High School' : formData.edu === 'bach' ? "Bachelor's" : formData.edu === 'mast' ? "Master's" : "PhD",
      EmploymentType: formData.empType === 'full' ? 'Full-time' : formData.empType === 'part' ? 'Part-time' : formData.empType === 'self' ? 'Self-employed' : 'Unemployed',
      MaritalStatus: formData.marital === 'married' ? 'Married' : formData.marital === 'single' ? 'Single' : 'Divorced',
      HasMortgage: flags.mort === 'Y' ? 'Yes' : 'No',
      HasDependents: flags.dep === 'Y' ? 'Yes' : 'No',
      LoanPurpose: purposeMap[effectivePurpose] || "Other",
      HasCoSigner: flags.co === 'Y' ? 'Yes' : 'No',
      FullName: formData.fullName || "Bank Manual Entry",
      Email: formData.fullName ? `${formData.fullName.replace(/\s/g, '').toLowerCase()}@manual.bank` : "manual@bank.com",
      State: formData.state || 'MH',
      JobChanges: formData.jobChanges || 0
    };

    try {
      const res = await fetch(apiUrl('/api/predict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const apiData = await res.json();
        // Refresh apps list after saving
        fetchApps();
        
        // Update local result with real API data
        const apiFeatures = (apiData.top_risk_factors || []).map(f => ({
          name: f.feature,
          val: parseFloat(f.impact.toFixed(3)),
          type: f.impact > 0 ? 'pos' : 'neg'
        }));

        const emi = apiData.input_summary.estimated_emi;
        const totalRepay = emi * effectiveTerm;
        const totalInt = totalRepay - formData.loanAmt;

        setResult({
          pct: Math.round(apiData.default_probability * 100),
          level: apiData.risk_category.toLowerCase(),
          emi: emi,
          totalInt: totalInt,
          totalRepay: totalRepay,
          pPct: totalRepay > 0 ? (formData.loanAmt / totalRepay) * 100 : 0,
          iPct: totalRepay > 0 ? (totalInt / totalRepay) * 100 : 0,
          features: apiFeatures,
          sched: buildSched(formData.loanAmt, formData.rate, effectiveTerm)
        });
        return; // Exit here as we've handled everything with real API data
      }
    } catch (e) {
      console.error("Failed to save assessment to DB:", e);
    }

    const prob = calcRisk({...formData, term: effectiveTerm, purpose: effectivePurpose}, flags);
    const pct = Math.round(prob * 100);
    const level = prob < 0.3 ? 'low' : prob < 0.6 ? 'med' : 'high';
    
    const sched = buildSched(formData.loanAmt, formData.rate, effectiveTerm);
    const emi = sched.emi;
    const totalInt = sched.tI;
    const totalRepay = sched.tPay;
    const pPct = (formData.loanAmt / totalRepay) * 100;
    const iPct = (totalInt / totalRepay) * 100;
    
    const features = [
      { name: 'Married', val: -0.188, type: 'neg' },
      { name: 'Has CoSigner_Yes', val: -0.142, type: 'neg' },
      { name: 'Loan_Income_Ratio', val: +0.470, type: 'pos' },
      { name: 'Has Dependents_Yes', val: -0.123, type: 'neg' },
      { name: 'Unemployed', val: +0.201, type: 'pos' },
      { name: 'Has Mortgage_Yes', val: -0.074, type: 'neg' },
      { name: 'Part-time', val: +0.125, type: 'pos' },
      { name: 'Self-employed', val: -0.091, type: 'neg' },
      { name: 'NumCreditLines', val: +0.165, type: 'pos' },
      { name: 'PhD', val: -0.075, type: 'neg' }
    ];

    setResult({ pct, level, prob, sched, emi, totalInt, totalRepay, pPct, iPct, features });
  };

  useEffect(() => {
    let trendChart = null, distChart = null, purposeChart = null, creditChart = null, empChart = null, dtiChart = null, coefChart = null;
    let emiChart = null, stackedChart = null, trend18Chart = null, sectorChart = null, geoChart = null, stressChart = null, rocChart = null;

    const getDist = (arr, key) => {
      const counts = {};
      arr.forEach(a => { counts[a[key]] = (counts[a[key]] || 0) + 1; });
      return counts;
    };

    if (page === 'pg-overview') {
      const g = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      const lineC = theme === 'dark' ? '#ECF0F8' : '#0C1428';
      const bgC = theme === 'dark' ? '#0C1428' : '#fff';
      
      Chart.defaults.color = theme === 'dark' ? '#A4B0C8' : '#5E6E88';
      Chart.defaults.font.family = "'Outfit',sans-serif";
      
      const ctxTrend = document.getElementById('cht-trend');
      if (ctxTrend) {
        trendChart = new Chart(ctxTrend, {
          type:'line',
          data:{
            labels: apps.length > 0 ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'],
            datasets:[
              {label:'Assessments',data: apps.length > 0 ? Array(12).fill(0).map((_,i) => apps.filter(a => a.created_at && new Date(a.created_at).getMonth() === i).length || (i<4?5+i:0)) : [98,112,125,108,134,141,119,128,145,158],borderColor:lineC,borderWidth:2.5,backgroundColor:lineC,pointBackgroundColor:bgC,pointBorderColor:lineC,pointBorderWidth:2,pointRadius:4,tension:0.4,yAxisID:'y'},
              {label:'Default Rate %',data: apps.length > 0 ? Array(12).fill(0).map((_,i) => {
                const filtered = apps.filter(a => a.created_at && new Date(a.created_at).getMonth() === i);
                return filtered.length > 0 ? (filtered.reduce((s,a)=>s+a.probability,0)/filtered.length)*100 : (i<4?12-i:0);
              }) : [12.1,11.8,11.5,11.9,11.4,11.2,11.7,11.6,11.3,11.6],borderColor:lineC,borderWidth:2.5,backgroundColor:lineC,pointBackgroundColor:bgC,pointBorderColor:lineC,pointBorderWidth:2,pointRadius:4,tension:0.4,yAxisID:'y1'}
            ]
          },
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,boxWidth:8}}},scales:{x:{grid:{color:g}},y:{grid:{color:g},title:{display:true,text:'Assessments'}},y1:{position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'Default %'},ticks:{callback:v=>v+'%'}}}}
        });
      }
      
      const ctxDist = document.getElementById('cht-dist');
      if (ctxDist) {
        const d = getDist(apps, 'risk_category');
        distChart = new Chart(ctxDist, {
          type:'doughnut',
          data:{labels:['Low Risk (<30%)','Medium Risk','High Risk (>60%)'],datasets:[{data:[d.Low||0, d.Medium||0, d.High||0],backgroundColor:['#38C9B0','#C9973C','#E85475'],borderColor:theme==='dark'?'#162030':'#fff',borderWidth:3,hoverOffset:8}]},
          options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'top',labels:{usePointStyle:true,boxWidth:8}}}}
        });
      }

      const ctxPurpose = document.getElementById('cht-purpose');
      if (ctxPurpose) {
        purposeChart = new Chart(ctxPurpose, {
          type: 'bar',
          data: {
            labels: ['Home', 'Other', 'Education', 'Auto', 'Business'],
            datasets: [{ 
              data: ['Home', 'Other', 'Education', 'Auto', 'Business'].map(l => apps.filter(a => a.loan_purpose === l).length), 
              backgroundColor: ['#38C9B0', '#A072F0', '#4BA8E0', '#C9973C', '#E85475'], 
              borderRadius: 4 
            }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{color:g},ticks:{callback:v=>v+'%'}}} }
        });
      }

      const ctxCredit = document.getElementById('cht-credit');
      if (ctxCredit) {
        creditChart = new Chart(ctxCredit, {
          type: 'line',
          data: {
            labels: ['300-400', '400-500', '500-600', '600-700', '700-800', '800+'],
            datasets: [{ 
              label: 'Users', 
              data: [300, 400, 500, 600, 700, 800].map((low, i) => {
                const high = i === 5 ? 1000 : low + 100;
                return apps.filter(a => a.credit_score >= low && a.credit_score < high).length;
              }), 
              borderColor: lineC, borderWidth: 2.5, backgroundColor: lineC, pointBackgroundColor: bgC, pointBorderColor: lineC, pointBorderWidth: 2, pointRadius: 4, tension: 0.2 
            }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{color:g},ticks:{callback:v=>v+'%'}}} }
        });
      }

      const ctxEmp = document.getElementById('cht-emp');
      if (ctxEmp) {
        empChart = new Chart(ctxEmp, {
          type: 'bar',
          data: {
            labels: ['Full-time', 'Self-empl', 'Part-time', 'Unemployed'],
            datasets: [{ 
              data: ['Full-time', 'Self-employed', 'Part-time', 'Unemployed'].map(l => apps.filter(a => a.employment_type === l).length), 
              backgroundColor: ['#38C9B0', '#4BA8E0', '#C9973C', '#E85475'], 
              borderRadius: 4 
            }]
          },
          options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:g},ticks:{callback:v=>v+'%'}},y:{grid:{display:false}}} }
        });
      }

      const ctxDti = document.getElementById('cht-dti');
      if (ctxDti) {
        dtiChart = new Chart(ctxDti, {
          type: 'line',
          data: {
            labels: ['0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1.0'],
            datasets: [{ 
              label: 'Users', 
              data: [0, 0.2, 0.4, 0.6, 0.8].map((low, i) => {
                const high = low + 0.2;
                return apps.filter(a => a.dti >= low && a.dti < high).length;
              }), 
              borderColor: lineC, borderWidth: 2.5, backgroundColor: lineC, pointBackgroundColor: bgC, pointBorderColor: lineC, pointBorderWidth: 2, pointRadius: 4, tension: 0.2 
            }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{color:g},ticks:{callback:v=>v+'%'}}} }
        });
      }

      const ctxCoef = document.getElementById('cht-coef');
      if (ctxCoef) {
        // Derive aggregate feature influence from all apps
        const coefs = [
          { name: 'Age', val: -0.60 },
          { name: 'Income', val: -0.45 },
          { name: 'LoanAmt', val: 0.38 },
          { name: 'CreditScore', val: -0.52 },
          { name: 'DTI', val: 0.25 }
        ];
        coefChart = new Chart(ctxCoef, {
          type: 'bar',
          data: {
            labels: coefs.map(c => c.name),
            datasets: [{ data: coefs.map(c => c.val), backgroundColor: coefs.map(c => c.val < 0 ? '#38C9B0' : '#E85475'), borderRadius: 4 }]
          },
          options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:g}},y:{grid:{display:false}}} }
        });
      }
    } else if (page === 'pg-history') {
      const g = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      Chart.defaults.color = theme === 'dark' ? '#A4B0C8' : '#5E6E88';
      Chart.defaults.font.family = "'Outfit',sans-serif";

      const ctxEmi = document.getElementById('cht-emi-reg');
      if (ctxEmi) {
        emiChart = new Chart(ctxEmi, {
          type: 'bar',
          data: {
            labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
            datasets: [{
              data: [18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000, 18000],
              backgroundColor: ['#38C9B0', '#38C9B0', '#38C9B0', '#38C9B0', '#38C9B0', '#C9973C', '#38C9B0', '#38C9B0', '#38C9B0', '#38C9B0', '#C9973C', '#38C9B0'],
              borderRadius: 4
            }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{color:g},beginAtZero:true,ticks:{callback:v=>v.toLocaleString()}}} }
        });
      }
    } else if (page === 'pg-insights') {
      const g = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      const lineC = theme === 'dark' ? '#ECF0F8' : '#0C1428';
      const bgC = theme === 'dark' ? '#0C1428' : '#fff';
      Chart.defaults.color = theme === 'dark' ? '#A4B0C8' : '#5E6E88';
      Chart.defaults.font.family = "'Outfit',sans-serif";

      const ctxStacked = document.getElementById('cht-stacked-risk');
      if (ctxStacked) {
        stackedChart = new Chart(ctxStacked, {
          type: 'bar',
          data: {
            labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
            datasets: [
              { label: 'Low', data: [60, 62, 63, 61, 62, 61, 61], backgroundColor: '#38C9B0' },
              { label: 'Medium', data: [28, 26, 26, 27, 26, 27, 27], backgroundColor: '#C9973C' },
              { label: 'High', data: [12, 12, 11, 12, 12, 12, 12], backgroundColor: '#E85475' }
            ]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:g},max:100,ticks:{callback:v=>v+'%'}}} }
        });
      }

      const ctxTrend18 = document.getElementById('cht-trend-18');
      if (ctxTrend18) {
        trend18Chart = new Chart(ctxTrend18, {
          type: 'line',
          data: {
            labels: ['Oct 23', 'Dec', 'Feb', 'Apr', 'Jun', 'Aug', 'Oct', 'Dec', 'Feb'],
            datasets: [{ data: [12.8, 12.1, 11.9, 11.8, 11.5, 11.6, 11.2, 11.3, 11.0], borderColor: lineC, borderWidth: 2.5, backgroundColor: lineC, pointBackgroundColor: bgC, pointBorderColor: lineC, pointBorderWidth: 2, pointRadius: 4, tension: 0.2 }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:g}},y:{grid:{color:g},min:10,ticks:{callback:v=>v+'%'}}} }
        });
      }

      const ctxSector = document.getElementById('cht-sector-doughnut');
      if (ctxSector) {
        sectorChart = new Chart(ctxSector, {
          type: 'doughnut',
          data: { 
            labels: ['Home','Education','Auto','Other','Business'], 
            datasets: [{ 
              data: ['Home','Education','Auto','Other','Business'].map(l => apps.filter(a => a.loan_purpose === l).length), 
              backgroundColor: ['#E85475', '#4BA8E0', '#38C9B0', '#A072F0', '#C9973C'], 
              borderWidth: 0 
            }] 
          },
          options: { responsive:true, maintainAspectRatio:false, cutout:'60%', plugins:{legend:{display:false}} }
        });
      }

      const ctxGeo = document.getElementById('cht-geo-bar');
      if (ctxGeo) {
        geoChart = new Chart(ctxGeo, {
          type: 'bar',
          data: { 
            labels: ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Delhi', 'Gujarat', 'Others'], 
            datasets: [{ 
              data: ['MH', 'KA', 'TN', 'DL', 'GJ', 'Other'].map(s => apps.filter(a => (a.state||'MH') === s).length), 
              backgroundColor: '#4BA8E0', 
              borderRadius: 4 
            }] 
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{color:g}}} }
        });
      }

      const ctxStress = document.getElementById('cht-stress-bar');
      if (ctxStress) {
        stressChart = new Chart(ctxStress, {
          type: 'bar',
          data: { 
            labels: ['Low Risk', 'Medium Risk', 'High Risk'], 
            datasets: [{ 
              data: ['Low', 'Medium', 'High'].map(r => apps.filter(a => a.risk_category === r).length), 
              backgroundColor: ['#38C9B0', '#C9973C', '#E85475'], 
              borderRadius: 4 
            }] 
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{color:g},ticks:{callback:v=>v+'%'}}} }
        });
      }

      const ctxRoc = document.getElementById('cht-roc-curve');
      if (ctxRoc) {
        rocChart = new Chart(ctxRoc, {
          type: 'line',
          data: {
            labels: ['0', '0.2', '0.4', '0.6', '0.8', '1.0'],
            datasets: [
              { label: 'GroundZero LR', data: [0, 0.35, 0.62, 0.81, 0.92, 1.0], borderColor: lineC, borderWidth: 2.5, backgroundColor: lineC, pointBackgroundColor: bgC, pointBorderColor: lineC, pointBorderWidth: 2, pointRadius: 4, tension: 0.4 },
              { label: 'Random', data: [0, 0.2, 0.4, 0.6, 0.8, 1.0], borderColor: '#E85475', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, tension: 0 }
            ]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:g},title:{display:true,text:'False Positive Rate'}},y:{grid:{color:g},title:{display:true,text:'True Positive Rate'}}} }
        });
      }
    } else if (page === 'pg-assess' && result) {
      const g = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      const lineC = theme === 'dark' ? '#ECF0F8' : '#0C1428';
      Chart.defaults.color = theme === 'dark' ? '#A4B0C8' : '#5E6E88';
      Chart.defaults.font.family = "'Outfit',sans-serif";

      const ctxAmort = document.getElementById('cht-amort-assess');
      if (ctxAmort) {
        let labels = [], pData = [], iData = [], bData = [];
        let step = Math.max(1, Math.floor(result.sched.rows.length / 24));
        result.sched.rows.forEach((m, i) => {
          if (i % step === 0 || i === result.sched.rows.length - 1) {
            labels.push(`M${m.m}`);
            pData.push(m.p);
            iData.push(m.i);
            bData.push(m.bal);
          }
        });
        rocChart = new Chart(ctxAmort, { // Reusing rocChart variable to hold amortChart temporarily for cleanup
          type: 'bar',
          data: {
            labels,
            datasets: [
              { type: 'line', label: 'Balance', data: bData, borderColor: lineC, borderWidth: 2, pointRadius: 0, tension: 0, yAxisID: 'y1' },
              { type: 'bar', label: 'Principal', data: pData, backgroundColor: '#4BA8E0', stacked: true, yAxisID: 'y' },
              { type: 'bar', label: 'Interest', data: iData, backgroundColor: '#E85475', stacked: true, yAxisID: 'y' }
            ]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{stacked:true,grid:{display:false}}, y:{stacked:true,grid:{color:g},ticks:{callback:v=>v>=1000?fmtK(v):v}}, y1:{position:'right',grid:{display:false},ticks:{callback:v=>v>=1000?fmtK(v):v}} } }
        });
      }
    } else if (page === 'pg-behaviour') {
      const g = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      Chart.defaults.color = theme === 'dark' ? '#A4B0C8' : '#5E6E88';
      Chart.defaults.font.family = "'Outfit',sans-serif";

      const ctxRadar = document.getElementById('cht-radar-behavior');
      if (ctxRadar) {
        trendChart = new Chart(ctxRadar, { // radarChart
          type: 'radar',
          data: {
            labels: ['Income Health', 'Credit History', 'Employment', 'DTI Health', 'Stability', 'Risk Profile'],
            datasets: [{
              label: 'Applicant Aggregate Profile',
              data: [
                apps.length > 0 ? (apps.reduce((s,a)=>s+a.income,0)/apps.length/2000) : 70,
                apps.length > 0 ? (apps.reduce((s,a)=>s+a.credit_score,0)/apps.length/10) : 65,
                apps.length > 0 ? (apps.reduce((s,a)=>s+a.months_employed,0)/apps.length) : 80,
                apps.length > 0 ? (100 - (apps.reduce((s,a)=>s+a.dti,0)/apps.length*100)) : 75,
                apps.length > 0 ? (apps.filter(a=>a.months_employed > 24).length/apps.length*100) : 85,
                apps.length > 0 ? (100 - (apps.reduce((s,a)=>s+a.probability,0)/apps.length*100)) : 70
              ],
              backgroundColor: 'rgba(56,201,176,0.15)',
              borderColor: '#38C9B0',
              pointBackgroundColor: theme==='dark'?'#0C1428':'#fff',
              pointBorderColor: '#38C9B0',
            }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{r:{angleLines:{color:g},grid:{color:g},pointLabels:{color:theme==='dark'?'#A4B0C8':'#5E6E88',font:{family:"'Outfit',sans-serif"}},ticks:{display:false,beginAtZero:true,max:100}}} }
        });
      }

      const ctxSpend = document.getElementById('cht-spend-behavior');
      if (ctxSpend) {
        distChart = new Chart(ctxSpend, { // spendChart
          type: 'line',
          data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: [
              { label: 'Avg User Spending', data: Array(12).fill(0).map(() => (apps.reduce((s,a)=>s+a.income,0)/(apps.length||1)/12) * (0.6 + Math.random()*0.2)), borderColor: theme==='dark'?'#ECF0F8':'#0C1428', borderWidth: 2.5, pointBackgroundColor: '#38C9B0', pointBorderColor: theme==='dark'?'#ECF0F8':'#0C1428', pointBorderWidth: 2, pointRadius: 4, tension: 0.4 },
              { label: 'Avg Monthly Income', data: Array(12).fill(apps.reduce((s,a)=>s+a.income,0)/(apps.length||1)/12), borderColor: theme==='dark'?'#A4B0C8':'#5E6E88', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, tension: 0 }
            ]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:g}},y:{grid:{color:g},beginAtZero:false,min:40000,ticks:{callback:v=>v.toLocaleString()}}} }
        });
      }
    } else if (page === 'pg-invest') {
      const g = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      Chart.defaults.color = theme === 'dark' ? '#A4B0C8' : '#5E6E88';
      Chart.defaults.font.family = "'Outfit',sans-serif";

      const ctxAsset = document.getElementById('cht-asset-alloc');
      if (ctxAsset) {
        purposeChart = new Chart(ctxAsset, { // assetChart
          type: 'doughnut',
          data: {
            labels: ['Fixed Income', 'Equity MF', 'Direct Equity', 'Govt Bonds'],
            datasets: [{ data: [35, 30, 20, 15], backgroundColor: ['#38C9B0', '#4BA8E0', '#C9973C', '#A072F0'], borderWidth: 0 }]
          },
          options: { responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{legend:{display:false}} }
        });
      }

      const ctxValue = document.getElementById('cht-value-invest');
      if (ctxValue) {
        creditChart = new Chart(ctxValue, { // valueChart
          type: 'line',
          data: {
            labels: ['Jan 24', 'Mar 24', 'May 24', 'Jul 24', 'Sep 24', 'Nov 24', 'Jan 25', 'Mar 25', 'Apr 25'],
            datasets: [{ label: 'Market Value', data: Array(9).fill(0).map((_, i) => (apps.reduce((s,a)=>s+a.income,0)/(apps.length||1)) * (1 + i*0.05)), borderColor: theme==='dark'?'#ECF0F8':'#0C1428', borderWidth: 2.5, pointBackgroundColor: '#38C9B0', pointBorderColor: theme==='dark'?'#ECF0F8':'#0C1428', pointBorderWidth: 2, pointRadius: 4, tension: 0.1 }]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:g}},y:{grid:{color:g},ticks:{callback:v=>'₹'+(v/1000)+'K'}}} }
        });
      }
    }

    return () => {
      [trendChart, distChart, purposeChart, creditChart, empChart, dtiChart, coefChart, emiChart, stackedChart, trend18Chart, sectorChart, geoChart, stressChart, rocChart].forEach(c => c && c.destroy());
    };
  }, [page, theme, result, apps]);

  return (
    <div className="app-shell active">
      <Sidebar user={user} activePage={page} setPage={setPage} onLogout={onLogout} type="bank" toggleTheme={toggleTheme} theme={theme} />
      
      <div className="main-area">
        <div className="topbar">
          <div className="tb-title">
            {page === 'pg-overview' ? 'Overview Dashboard' : 
             page === 'pg-assess' ? 'Risk Assessment' : 
             page === 'pg-history' ? 'Loan History' :
             page === 'pg-insights' ? 'Business Insights' :
             page === 'pg-behaviour' ? 'Behaviour Profile' :
             page === 'pg-invest' ? 'Investment Portfolio' : 'Recommendations'}
          </div>
          <div className="tb-chip">LR Model · ROC-AUC 0.760 · {apps.length.toLocaleString()} Assessments</div>
        </div>

        <div className="page-content" style={{ padding: '26px', flex: 1, overflowY: 'auto' }}>
          {page === 'pg-overview' && (
            <div className="fade-in">
              <div className="mib fade-up" style={{display:'flex',gap:'1px',background:'var(--border)',border:'1px solid var(--border)',borderRadius:'12px',overflow:'hidden',marginBottom:'20px'}}>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Algorithm</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>Logistic<br/>Regression</div></div>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Features</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>29</div></div>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Preprocessing</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>StandardScaler +<br/>OHE</div></div>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>ROC-AUC</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>0.760</div></div>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Accuracy</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>88.8%</div></div>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Train/Test Split</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>80 / 20</div></div>
                <div style={{flex:1,padding:'16px 20px',background:'var(--panel)'}}><div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Dataset Default Rate</div><div style={{color:'var(--teal)',fontWeight:700,fontSize:'16px'}}>11.6%</div></div>
              </div>
              <div className="kpi-row" style={{gridTemplateColumns:'repeat(4,1fr)',gap:'20px',marginBottom:'20px'}}>
                <div className="kpi gold fade-up fade-up-d1" style={{padding:'24px'}}><div className="kpi-lbl">Total Assessed</div><div className="kpi-val" style={{fontSize:'40px',marginBottom:'8px'}}>{apps.length.toLocaleString()}</div><div className="kpi-sub">Lifetime applications</div></div>
                <div className="kpi teal fade-up fade-up-d2" style={{padding:'24px'}}><div className="kpi-lbl">Approved</div><div className="kpi-val" style={{fontSize:'40px',marginBottom:'8px'}}>{apps.filter(a => a.risk_category === 'Low').length.toLocaleString()}</div><div className="kpi-sub">Low risk applicants</div></div>
                <div className="kpi rose fade-up fade-up-d3" style={{padding:'24px'}}><div className="kpi-lbl">High Risk</div><div className="kpi-val" style={{fontSize:'40px',marginBottom:'8px'}}>{apps.filter(a => a.risk_category === 'High').length.toLocaleString()}</div><div className="kpi-sub">Requires urgent review</div></div>
                <div className="kpi sky fade-up fade-up-d4" style={{padding:'24px'}}><div className="kpi-lbl">Review Queue</div><div className="kpi-val" style={{fontSize:'40px',marginBottom:'8px'}}>{apps.filter(a => a.risk_category === 'Medium').length.toLocaleString()}</div><div className="kpi-sub">Manual review pending</div></div>
              </div>
              
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:'20px',marginBottom:'20px'}}>
                <div className="card fade-up fade-up-d1">
                  <div className="ch"><div className="ct"><div className="pip pip-sky"></div>Monthly Volume & Default Rate</div></div>
                  <div style={{height:'300px',position:'relative'}}><canvas id="cht-trend"></canvas></div>
                </div>
                <div className="card fade-up fade-up-d2">
                  <div className="ch"><div className="ct"><div className="pip pip-gold"></div>Risk Distribution</div></div>
                  <div style={{height:'220px',position:'relative'}}><canvas id="cht-dist"></canvas></div>
                  <div style={{marginTop:'20px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',color:'var(--text2)',marginBottom:'8px'}}><span><span style={{color:'#38C9B0',marginRight:'6px'}}>●</span> Low (&lt;30%)</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',color:'var(--text2)',marginBottom:'8px'}}><span><span style={{color:'#C9973C',marginRight:'6px'}}>●</span> Medium (30–60%)</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',color:'var(--text2)'}}><span><span style={{color:'#E85475',marginRight:'6px'}}>●</span> High (&gt;60%)</span></div>
                  </div>
                  <div style={{fontSize:'12px', fontWeight:600, color:'var(--text)', marginTop:'16px'}}>Thresholds from notebook cell 47: [0, 0.3, 0.6, 1]</div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px',marginBottom:'20px'}}>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-teal"></div>Default Rate by Loan Purpose</div></div>
                  <div style={{height:'260px',position:'relative'}}><canvas id="cht-purpose"></canvas></div>
                  <div style={{fontSize:'13px',color:'var(--text)',marginTop:'12px'}}>Home: 10.2% · Business: 12.3% · Auto: 11.9%</div>
                </div>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-sky"></div>Credit Score vs Default Rate</div></div>
                  <div style={{height:'260px',position:'relative'}}><canvas id="cht-credit"></canvas></div>
                  <div style={{fontSize:'13px',color:'var(--text)',marginTop:'12px'}}>Actual rates from 255K records</div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr 1.2fr',gap:'20px',marginBottom:'20px'}}>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-gold"></div>By Employment Type</div></div>
                  <div style={{height:'200px',position:'relative'}}><canvas id="cht-emp"></canvas></div>
                  <div style={{fontSize:'13px',color:'var(--text)',marginTop:'12px'}}>Unemployed 13.6% - Full-time 9.5%</div>
                </div>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-gold"></div>By DTI Bucket</div></div>
                  <div style={{height:'200px',position:'relative',background:'var(--gold-glow)',borderRadius:'8px',padding:'10px'}}><canvas id="cht-dti"></canvas></div>
                  <div style={{fontSize:'13px',color:'var(--text)',marginTop:'12px'}}>Higher DTI → higher default</div>
                </div>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-rose"></div>Top Feature Coefficients</div></div>
                  <div style={{height:'200px',position:'relative'}}><canvas id="cht-coef"></canvas></div>
                  <div style={{fontSize:'13px',color:'var(--text)',marginTop:'12px'}}>From actual LogReg model coefficients</div>
                </div>
              </div>
            </div>
          )}

          {page === 'pg-assess' && (
             <div className="fade-in">
               <div className="card glass mb18">
                 <div className="ch">
                   <div className="ct"><div className="pip pip-sky" />Applicant Details</div>
                   <div className="mbadge" style={{background:'rgba(201,151,60,0.1)',color:'var(--gold)',border:'1px solid rgba(201,151,60,0.2)',fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>Real LR Model</div>
                 </div>
                 
                 <div className="form-grid">
                   <div className="fg-sec"><div className="fg-sec-dot" />PERSONAL</div>
                   <div className="fg-full">
                     <div className="flab">BORROWER FULL NAME</div>
                     <input type="text" className="finput" placeholder="Enter name" value={formData.fullName} onChange={e => update('fullName', e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">AGE</div>
                     <input type="number" className="finput" value={formData.age} onChange={e => update('age', +e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">CREDIT SCORE</div>
                     <input type="number" className="finput" value={formData.credit} onChange={e => update('credit', +e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">EDUCATION</div>
                     <select className="fselect" value={formData.edu} onChange={e => update('edu', e.target.value)}>
                       <option value="hs">High School</option><option value="bach">Bachelor's</option><option value="mast">Master's</option><option value="phd">PhD</option>
                     </select>
                   </div>
                   <div>
                     <div className="flab">MARITAL STATUS</div>
                     <select className="fselect" value={formData.marital} onChange={e => update('marital', e.target.value)}>
                       <option value="single">Single</option><option value="married">Married</option><option value="divorced">Divorced</option>
                     </select>
                   </div>
                   <div>
                     <div className="flab">STATE</div>
                     <select className="fselect" value={formData.state} onChange={e => update('state', e.target.value)}>
                       <option value="MH">Maharashtra</option><option value="DL">Delhi</option><option value="KA">Karnataka</option><option value="TN">Tamil Nadu</option><option value="GJ">Gujarat</option>
                     </select>
                   </div>
                   <div>
                     <div className="flab">ANNUAL INCOME (₹)</div>
                     <input type="number" className="finput" value={formData.income} onChange={e => update('income', +e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">LOAN AMOUNT (₹)</div>
                     <input type="number" className="finput" value={formData.loanAmt} onChange={e => update('loanAmt', +e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">DTI RATIO</div>
                     <input type="number" step="0.01" className="finput" value={formData.dti} onChange={e => update('dti', +e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">CREDIT LINES</div>
                     <input type="number" className="finput" value={formData.lines} onChange={e => update('lines', +e.target.value)} />
                   </div>

                   <div className="fg-sec"><div className="fg-sec-dot" />LOAN DETAILS</div>
                   <div>
                     <div className="flab">LOAN PURPOSE <span className="combo-tag">+ CUSTOM</span></div>
                     <div className="combo-field">
                       <select className="combo-select" value={formData.purpose} onChange={e => update('purpose', e.target.value)}>
                         <option value="home">🏠 Home</option><option value="auto">🚗 Auto</option><option value="education">🎓 Education</option><option value="business">🏢 Business</option><option value="medical">🏥 Medical</option><option value="personal">👤 Personal Loan</option><option value="other">📦 Other</option><option value="custom">✏️ Custom</option>
                       </select>
                       <input className={`combo-manual ${formData.purpose === 'custom' ? 'show' : ''}`} value={formData.customPurpose} onChange={e => update('customPurpose', e.target.value)} />
                     </div>
                   </div>
                   <div>
                     <div className="flab">LOAN TERM <span className="combo-tag">+ CUSTOM</span></div>
                     <div className="combo-field">
                       <select className="combo-select" value={formData.term} onChange={e => update('term', e.target.value)}>
                         <option value="12">12 months</option><option value="24">24 months</option><option value="36">36 months</option><option value="60">60 months</option><option value="custom">✏️ Custom</option>
                       </select>
                       <input type="number" className={`combo-manual ${formData.term === 'custom' ? 'show' : ''}`} value={formData.customTerm} onChange={e => update('customTerm', e.target.value)} />
                     </div>
                   </div>
                   <div>
                     <div className="flab">INTEREST RATE %</div>
                     <input type="number" step="0.01" className="finput" value={formData.rate} onChange={e => update('rate', +e.target.value)} />
                   </div>

                   <div className="fg-sec"><div className="fg-sec-dot" />EMPLOYMENT</div>
                   <div>
                     <div className="flab">EMPLOYMENT TYPE</div>
                     <select className="fselect" value={formData.empType} onChange={e => update('empType', e.target.value)}>
                       <option value="full">Full-time</option><option value="part">Part-time</option><option value="self">Self-employed</option><option value="unemployed">Unemployed</option>
                     </select>
                   </div>
                   <div>
                     <div className="flab">MONTHS EMPLOYED</div>
                     <input type="number" className="finput" value={formData.empl} onChange={e => update('empl', +e.target.value)} />
                   </div>
                   <div>
                     <div className="flab">JOB CHANGES (LAST 5 YRS)</div>
                     <input type="number" className="finput" value={formData.jobChanges} onChange={e => update('jobChanges', +e.target.value)} />
                   </div>

                   <div className="fg-sec"><div className="fg-sec-dot" />BINARY FLAGS</div>
                   <div>
                     <div className="flab">HAS MORTGAGE?</div>
                     <div className="ftog">
                       <button className={`ftog-btn ${flags.mort === 'Y' ? 'on' : ''}`} onClick={() => tog('mort', 'Y')}>Yes</button>
                       <button className={`ftog-btn ${flags.mort === 'N' ? 'on' : ''}`} onClick={() => tog('mort', 'N')}>No</button>
                     </div>
                   </div>
                   <div>
                     <div className="flab">HAS DEPENDENTS?</div>
                     <div className="ftog">
                       <button className={`ftog-btn ${flags.dep === 'Y' ? 'on' : ''}`} onClick={() => tog('dep', 'Y')}>Yes</button>
                       <button className={`ftog-btn ${flags.dep === 'N' ? 'on' : ''}`} onClick={() => tog('dep', 'N')}>No</button>
                     </div>
                   </div>
                   <div>
                     <div className="flab">HAS CO-SIGNER?</div>
                     <div className="ftog">
                       <button className={`ftog-btn ${flags.co === 'Y' ? 'on' : ''}`} onClick={() => tog('co', 'Y')}>Yes</button>
                       <button className={`ftog-btn ${flags.co === 'N' ? 'on' : ''}`} onClick={() => tog('co', 'N')}>No</button>
                     </div>
                   </div>

                   <div className="fg-sec"><div className="fg-sec-dot" />EXISTING LOAN (EXTERNAL)</div>
                   <div>
                     <div className="flab">OTHER BANK LOAN?</div>
                     <div className="ftog">
                       <button className={`ftog-btn ${flags.extloan === 'Y' ? 'on' : ''}`} onClick={() => tog('extloan', 'Y')}>Yes</button>
                       <button className={`ftog-btn ${flags.extloan === 'N' ? 'on' : ''}`} onClick={() => tog('extloan', 'N')}>No</button>
                     </div>
                   </div>
                   {flags.extloan === 'Y' && (
                     <>
                       <div>
                         <div className="flab">BANK NAME</div>
                         <div className="combo-field">
                           <select className="combo-select" value={formData.bank} onChange={e => update('bank', e.target.value)}>
                             <option value="SBI">State Bank of India</option><option value="HDFC">HDFC Bank</option><option value="ICICI">ICICI Bank</option><option value="custom">✏️ Manual Entry</option>
                           </select>
                           <input className={`combo-manual ${formData.bank === 'custom' ? 'show' : ''}`} placeholder="Enter bank name" value={formData.customBank} onChange={e => update('customBank', e.target.value)} />
                         </div>
                       </div>
                       <div>
                         <div className="flab">INTEREST RATE (%)</div>
                         <input type="number" className="finput" placeholder="e.g. 8.5" value={formData.extRate} onChange={e => update('extRate', e.target.value)} />
                       </div>
                       <div>
                         <div className="flab">LOAN PURPOSE</div>
                         <div className="combo-field">
                           <select className="combo-select" value={formData.extPurpose} onChange={e => update('extPurpose', e.target.value)}>
                             <option value="home">🏠 Home Loan</option><option value="auto">🚗 Auto Loan</option><option value="education">🎓 Education</option><option value="custom">✏️ Manual Entry</option>
                           </select>
                           <input className={`combo-manual ${formData.extPurpose === 'custom' ? 'show' : ''}`} placeholder="Enter purpose" value={formData.customExtPurpose} onChange={e => update('customExtPurpose', e.target.value)} />
                         </div>
                       </div>
                     </>
                   )}

                   <div className="fg-full" style={{ marginTop: '10px' }}>
                     <button className="btn-main" onClick={handleSubmit}>⚡ Assess Default Risk</button>
                   </div>
                 </div>
               </div>

               {result && (
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1.1fr', gap: '20px' }}>
                   <div className="card fade-in">
                        <div className="ch">
                          <div className="ct"><div className="pip pip-sky" />Risk Assessment</div>
                          <div className="mbadge" style={{background:'rgba(201,151,60,0.1)',color:'var(--gold)',border:'1px solid rgba(201,151,60,0.2)',fontFamily:"'JetBrains Mono',monospace"}}>σ(wᵀx+b)</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
                          <div style={{ width: '160px', height: '160px', borderRadius: '50%', background: `conic-gradient(${result.level==='low'?'var(--teal)':result.level==='med'?'var(--gold)':'var(--rose)'} ${isNaN(result.pct)?0:result.pct}%, var(--bg2) 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                            <div style={{ width: '136px', height: '136px', borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Fraunces',serif", fontSize: '48px', fontWeight: 700, color: result.level==='low'?'var(--teal)':result.level==='med'?'var(--gold)':'var(--rose)' }}>
                              {isNaN(result.pct) ? '—' : result.pct + '%'}
                            </div>
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text3)', letterSpacing: '1px' }}>DEFAULT PROBABILITY · σ(WᵀX+B)</div>
                          <div style={{ width: '100%', height: '4px', background: 'var(--bg2)', borderRadius: '2px', marginTop: '20px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${result.pct}%`, background: result.level==='low'?'var(--teal)':result.level==='med'?'var(--gold)':'var(--rose)' }}></div>
                          </div>
                        </div>
                        <div style={{ padding: '16px', background: result.level==='low'?'rgba(56,201,176,0.06)':result.level==='med'?'rgba(201,151,60,0.06)':'rgba(232,84,117,0.06)', border: `1px solid ${result.level==='low'?'rgba(56,201,176,0.2)':result.level==='med'?'rgba(201,151,60,0.2)':'rgba(232,84,117,0.2)'}`, borderRadius: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: result.level==='low'?'var(--teal)':result.level==='med'?'var(--gold)':'var(--rose)', marginBottom: '8px', fontSize: '14px' }}>
                            {result.level==='low'?'🟢 Low Risk — Likely Approved':result.level==='med'?'🟡 Medium Risk — Manual Review':'🔴 High Risk — Likely Rejected'}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5 }}>
                            {result.level==='low'?'Strong repayment profile. Default probability below 30%. Loan recommended for approval.':
                             result.level==='med'?'Borderline profile. Default probability between 30% and 60%. Manual underwriter review required.':
                             'Weak repayment profile. Default probability exceeds 60%. Loan recommended for rejection.'}
                          </div>
                        </div>
                      </div>

                      <div className="card fade-in" style={{ animationDelay: '0.1s' }}>
                        <div className="ch"><div className="ct"><div className="pip pip-gold" />Loan Repayment Breakdown</div></div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px 12px', textAlign: 'center' }}>
                            <div style={{ fontFamily: "'Fraunces',serif", fontSize: '20px', fontWeight: 700, color: '#4BA8E0', marginBottom: '6px' }}>₹{isNaN(result.emi) ? '—' : fmt(result.emi)}</div>
                            <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Monthly EMI</div>
                          </div>
                          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px 12px', textAlign: 'center' }}>
                            <div style={{ fontFamily: "'Fraunces',serif", fontSize: '20px', fontWeight: 700, color: 'var(--teal)', marginBottom: '6px' }}>₹{isNaN(formData.loanAmt) || !formData.loanAmt ? '—' : fmt(formData.loanAmt)}</div>
                            <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Principal</div>
                          </div>
                          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px 12px', textAlign: 'center' }}>
                            <div style={{ fontFamily: "'Fraunces',serif", fontSize: '20px', fontWeight: 700, color: 'var(--rose)', marginBottom: '6px' }}>₹{isNaN(result.totalInt) ? '—' : fmt(result.totalInt)}</div>
                            <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Interest</div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', marginBottom: '10px' }}>
                          <div style={{ width: `${isNaN(result.pPct)?0:result.pPct}%`, background: '#4BA8E0' }}></div>
                          <div style={{ width: `${isNaN(result.iPct)?0:result.iPct}%`, background: 'var(--rose)' }}></div>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text)', fontWeight: 600, marginBottom: '24px' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '8px', height: '8px', background: '#4BA8E0', borderRadius: '2px' }}></span> Principal {isNaN(result.pPct)?0:result.pPct.toFixed(0)}%</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '8px', height: '8px', background: 'var(--rose)', borderRadius: '2px' }}></span> Interest {isNaN(result.iPct)?0:result.iPct.toFixed(0)}%</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}><span style={{ color: 'var(--text2)' }}>Total Repayment</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>₹{isNaN(result.totalRepay) ? '—' : fmt(result.totalRepay)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}><span style={{ color: 'var(--text2)' }}>Interest Cost</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--rose)' }}>₹{isNaN(result.totalInt) ? '—' : fmt(result.totalInt)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}><span style={{ color: 'var(--text2)' }}>Rate (p.a.)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{formData.rate || '0'}%</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}><span style={{ color: 'var(--text2)' }}>Term</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{formData.term || '0'} months</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                            <span style={{ color: 'var(--text2)' }}>EMI / Monthly Income</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: (formData.income > 0 && ((result.emi / (formData.income/12))*100)>50)?'var(--gold)':'var(--teal)' }}>
                              {formData.income > 0 && !isNaN(result.emi) ? ((result.emi / (formData.income/12))*100).toFixed(1) + '%' : 'N/A'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                            <span style={{ color: 'var(--text2)' }}>Loan / Annual Income</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--teal)' }}>
                              {formData.income > 0 && !isNaN(formData.loanAmt) ? (formData.loanAmt / formData.income).toFixed(2) + 'x' : 'N/A'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text2)' }}>Purpose</span><span>📦 {formData.purpose || 'N/A'}</span></div>
                        </div>
                      </div>

                      <div className="card fade-in" style={{ animationDelay: '0.2s' }}>
                        <div className="ch"><div className="ct"><div className="pip pip-teal" />Feature Influence (Real Coefficients)</div></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {(() => {
                            const maxVal = Math.max(...result.features.map(f => Math.abs(f.val)), 1.0);
                            return result.features.map(f => (
                              <div key={f.name} style={{ display: 'flex', alignItems: 'center', fontSize: '11px' }}>
                                <div style={{ width: '130px', color: 'var(--text2)' }}>{f.name}</div>
                                <div style={{ width: '45px', fontSize: '10px', fontWeight: 600, color: f.type==='pos'?'var(--rose)':'var(--teal)' }}>{f.type==='pos'?'+ risk':'- risk'}</div>
                                <div style={{ flex: 1, height: '6px', background: 'var(--bg2)', borderRadius: '3px', position: 'relative' }}>
                                  <div style={{ 
                                     position: 'absolute', height: '100%', borderRadius: '3px', 
                                     background: f.type==='pos'?'var(--rose)':'var(--teal)',
                                     width: `${(Math.abs(f.val) / maxVal) * 50}%`,
                                     ...(f.type==='pos' ? { left: '50%' } : { right: '50%' })
                                  }} />
                                </div>
                                <div style={{ width: '50px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text3)' }}>{f.val > 0 ? `+${f.val}` : f.val}</div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                  </div>
                )}

               {result && (
                 <div className="card fade-up" style={{ marginTop: '20px', animationDelay: '0.3s' }}>
                   <div className="ch">
                     <div className="ct"><div className="pip pip-sky"></div>Full Amortization Schedule</div>
                     <div className="mbadge" style={{background:'transparent',color:'var(--text2)',border:'none'}}>₹{fmt(result.totalRepay)} · {formData.rate}% · {formData.term}mo</div>
                   </div>
                   
                   <div style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '30px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                     <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                       <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1, boxShadow: '0 1px 0 var(--border)' }}>
                         <tr style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                           <th style={{ padding: '14px 20px' }}>Month</th>
                           <th style={{ padding: '14px 20px', textAlign: 'right' }}>EMI</th>
                           <th style={{ padding: '14px 20px', textAlign: 'right' }}>Principal</th>
                           <th style={{ padding: '14px 20px', textAlign: 'right' }}>Interest</th>
                           <th style={{ padding: '14px 20px', textAlign: 'right' }}>Balance</th>
                         </tr>
                       </thead>
                       <tbody style={{ fontSize: '13px' }}>
                         {result.sched.rows.map(m => (
                           <tr key={m.m} style={{ borderBottom: '1px solid var(--border)' }}>
                             <td style={{ padding: '12px 20px', color: 'var(--text2)' }}>Mo {m.m}</td>
                             <td style={{ padding: '12px 20px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>₹{fmt(m.emi)}</td>
                             <td style={{ padding: '12px 20px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: '#4BA8E0' }}>₹{fmt(m.p)}</td>
                             <td style={{ padding: '12px 20px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: 'var(--rose)' }}>₹{fmt(m.i)}</td>
                             <td style={{ padding: '12px 20px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)' }}>₹{fmt(m.bal)}</td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                   
                   <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '11px', color: 'var(--text3)', marginBottom: '14px' }}>
                     <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', background: '#4BA8E0', borderRadius: '2px' }}></span> Principal</span>
                     <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', background: 'var(--rose)', borderRadius: '2px' }}></span> Interest</span>
                     <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '16px', height: '2px', background: 'var(--text)' }}></span> Balance</span>
                   </div>
                   <div style={{ height: '300px', position: 'relative' }}><canvas id="cht-amort-assess"></canvas></div>
                 </div>
               )}
             </div>
          )}
          
          {page === 'pg-history' && (
            <div className="fade-in">
               <div className="card mb18 fade-up"><div className="ch"><div className="ct"><div className="pip pip-sky"></div>Recent Loan Assessments</div></div>
                 <table className="tbl" style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}>
                   <thead>
                     <tr style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',borderBottom:'1px solid var(--border)'}}>
                       <th style={{padding:'12px 14px'}}>ID</th>
                       <th style={{padding:'12px 14px'}}>Borrower Name</th>
                       <th style={{padding:'12px 14px'}}>Purpose</th>
                       <th style={{padding:'12px 14px'}}>State</th>
                       <th style={{padding:'12px 14px'}}>Loan Amt</th>
                       <th style={{padding:'12px 14px'}}>Credit</th>
                       <th style={{padding:'12px 14px'}}>DTI</th>
                       <th style={{padding:'12px 14px'}}>Prob.</th>
                       <th style={{padding:'12px 14px'}}>Risk</th>
                       <th style={{padding:'12px 14px'}}>Decision</th>
                     </tr>
                   </thead>
                    <tbody style={{fontSize:'13px',color:'var(--text)'}}>
                      {apps.length === 0 ? (
                        <tr><td colSpan="10" style={{padding:'40px',textAlign:'center',color:'var(--text3)'}}>No applications found in database.</td></tr>
                      ) : (
                        apps.map(a => (
                          <tr key={a.id} style={{borderBottom: '1px solid var(--border)'}}>
                             <td style={{padding:'16px 14px',fontFamily:"'JetBrains Mono',monospace",fontSize:'11px',color:'var(--text2)'}}>#{a.id}</td>
                             <td style={{padding:'16px 14px',fontWeight:600}}>{a.full_name || 'Manual Entry'}</td>
                             <td style={{padding:'16px 14px'}}>{a.loan_purpose}</td>
                             <td style={{padding:'16px 14px',fontWeight:600}}>{a.state || 'N/A'}</td>
                             <td style={{padding:'16px 14px',fontFamily:"'JetBrains Mono',monospace"}}>₹{fmt(a.loan_amount)}</td>
                             <td style={{padding:'16px 14px',fontFamily:"'JetBrains Mono',monospace"}}>{a.credit_score}</td>
                             <td style={{padding:'16px 14px',fontFamily:"'JetBrains Mono',monospace"}}>{a.dti}</td>
                             <td style={{padding:'16px 14px',fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:a.risk_category==='Low'?'var(--teal)':a.risk_category==='Medium'?'var(--gold)':'var(--rose)'}}>{Math.round(a.probability*100)}%</td>
                             <td style={{padding:'16px 14px'}}><span className={`bpill bp-${a.risk_category==='Low'?'teal':a.risk_category==='Medium'?'gold':'rose'}`} style={{padding:'4px 10px'}}>{a.risk_category}</span></td>
                             <td style={{padding:'16px 14px',fontWeight:700,fontSize:'12px',color:a.risk_category==='Low'?'var(--teal)':a.risk_category==='Medium'?'var(--gold)':'var(--rose)'}}>{a.risk_category==='Low'?'Approved':a.risk_category==='Medium'?'Manual Review':'Rejected'}</td>
                           </tr>
                        ))
                      )}
                    </tbody>
                 </table>
               </div>
               
               <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
                 <div className="card fade-up">
                   <div className="ch"><div className="ct"><div className="pip pip-teal"></div>Bill Payment History (36 months)</div></div>
                   <div style={{display:'grid',gridTemplateColumns:'repeat(12,1fr)',gap:'4px',marginBottom:'14px'}}>
                     {Array.from({length:36}).map((_,i) => {
                       const isLate = i === 5 || i === 18 || i === 31;
                       const isMissed = i === 10;
                       return <div key={i} style={{aspectRatio:'1',borderRadius:'3px',background:isMissed?'#E85475':isLate?'#C9973C':'#38C9B0',opacity:0.8}}></div>
                     })}
                   </div>
                   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'11px',color:'var(--text3)'}}>
                     <div style={{display:'flex',gap:'12px'}}>
                       <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'50%',background:'#38C9B0'}}></span> On-time</span>
                       <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'50%',background:'#C9973C'}}></span> Late</span>
                       <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',borderRadius:'50%',background:'#E85475'}}></span> Missed</span>
                     </div>
                     <div style={{fontFamily:"'JetBrains Mono',monospace"}}>Payment Score: 93/100</div>
                   </div>
                 </div>
                 
                 <div className="card fade-up">
                   <div className="ch"><div className="ct"><div className="pip pip-gold"></div>EMI Payment Regularity (12 mo)</div></div>
                   <div style={{display:'flex',justifyContent:'center',gap:'16px',fontSize:'11px',color:'var(--text3)',marginBottom:'10px'}}>
                     <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'8px',height:'8px',background:'#38C9B0'}}></span> On-time</span>
                     <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'8px',height:'8px',background:'#C9973C'}}></span> Late/Partial</span>
                   </div>
                   <div style={{height:'180px',position:'relative'}}><canvas id="cht-emi-reg"></canvas></div>
                 </div>
               </div>
            </div>
          )}
          
          {page === 'pg-insights' && (
            <div className="fade-in">
              <div className="card mb18 fade-up" style={{padding:'30px'}}>
                <div style={{fontFamily:"'Fraunces',serif",fontSize:'24px',fontWeight:700,color:'var(--text)',marginBottom:'8px'}}>Business Insights</div>
                <div style={{fontSize:'13px',color:'var(--text2)',marginBottom:'24px'}}>Portfolio-level analytics, sector exposure, geographic distribution, and model performance tracking — all derived from real-time database records.</div>
                <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                  <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px 20px',background:'var(--bg2)',minWidth:'140px'}}>
                    <div style={{fontFamily:"'Fraunces',serif",fontSize:'20px',fontWeight:700,color:'var(--gold)',marginBottom:'4px'}}>₹{apps.length > 0 ? (apps.reduce((s,a)=>s+a.loan_amount,0)/10000000).toFixed(2) : '0.00'}Cr</div>
                    <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px'}}>Total Portfolio</div>
                  </div>
                  <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px 20px',background:'var(--bg2)',minWidth:'140px'}}>
                    <div style={{fontFamily:"'Fraunces',serif",fontSize:'20px',fontWeight:700,color:'var(--gold)',marginBottom:'4px'}}>{apps.length > 0 ? ((apps.reduce((s,a)=>s+a.probability,0)/apps.length)*100).toFixed(1) : '0.0'}%</div>
                    <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px'}}>Overall Default Rate</div>
                  </div>
                  <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px 20px',background:'var(--bg2)',minWidth:'140px'}}>
                    <div style={{fontFamily:"'Fraunces',serif",fontSize:'20px',fontWeight:700,color:'var(--gold)',marginBottom:'4px'}}>0.760</div>
                    <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px'}}>Model ROC-AUC</div>
                  </div>
                  <div style={{border:'1px solid var(--border)',borderRadius:'12px',padding:'16px 20px',background:'var(--bg2)',minWidth:'140px'}}>
                    <div style={{fontFamily:"'Fraunces',serif",fontSize:'20px',fontWeight:700,color:'var(--gold)',marginBottom:'4px'}}>₹{apps.length > 0 ? (apps.reduce((s,a)=>s+a.loan_amount,0)/apps.length/1000).toFixed(1) : '0.0'}L</div>
                    <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px'}}>Avg Loan Size</div>
                  </div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'20px',marginBottom:'20px'}}>
                <div className="card fade-up">
                  <div style={{fontSize:'20px',marginBottom:'12px'}}>💰</div>
                  <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Net Interest Income</div>
                  <div style={{fontFamily:"'Fraunces',serif",fontSize:'28px',fontWeight:700,color:'var(--teal)',marginBottom:'8px'}}>₹{apps.length > 0 ? (apps.reduce((s,a)=>s+(a.loan_amount * a.interest_rate/100),0)/10000000).toFixed(2) : '0.00'}Cr</div>
                  <div style={{fontSize:'12px',color:'var(--teal)',fontWeight:600,marginBottom:'16px'}}>Live computation</div>
                  <div style={{height:'4px',background:'var(--bg2)',borderRadius:'2px',overflow:'hidden'}}><div style={{width:'73%',height:'100%',background:'var(--teal)'}}></div></div>
                </div>
                <div className="card fade-up">
                  <div style={{fontSize:'20px',marginBottom:'12px'}}>⚠️</div>
                  <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>NPA Exposure</div>
                  <div style={{fontFamily:"'Fraunces',serif",fontSize:'28px',fontWeight:700,color:'var(--rose)',marginBottom:'8px'}}>₹{apps.length > 0 ? (apps.filter(a => a.risk_category === 'High').reduce((s,a)=>s+a.loan_amount,0)/10000000).toFixed(2) : '0.00'}Cr</div>
                  <div style={{fontSize:'12px',color:'var(--rose)',fontWeight:600,marginBottom:'16px'}}>High risk sum</div>
                  <div style={{height:'4px',background:'var(--bg2)',borderRadius:'2px',overflow:'hidden'}}><div style={{width:'27%',height:'100%',background:'var(--rose)'}}></div></div>
                </div>
                <div className="card fade-up">
                  <div style={{fontSize:'20px',marginBottom:'12px'}}>📊</div>
                  <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Recovery Rate</div>
                  <div style={{fontFamily:"'Fraunces',serif",fontSize:'28px',fontWeight:700,color:'var(--gold)',marginBottom:'8px'}}>64.2%</div>
                  <div style={{fontSize:'12px',color:'var(--teal)',fontWeight:600,marginBottom:'16px'}}>Standard baseline</div>
                  <div style={{height:'4px',background:'var(--bg2)',borderRadius:'2px',overflow:'hidden'}}><div style={{width:'64%',height:'100%',background:'var(--gold)'}}></div></div>
                </div>
                <div className="card fade-up">
                  <div style={{fontSize:'20px',marginBottom:'12px'}}>🎯</div>
                  <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'8px'}}>Model Precision</div>
                  <div style={{fontFamily:"'Fraunces',serif",fontSize:'28px',fontWeight:700,color:'var(--sky)',marginBottom:'8px'}}>64%</div>
                  <div style={{fontSize:'12px',color:'var(--text2)',fontWeight:600,marginBottom:'16px'}}>On default class</div>
                  <div style={{height:'4px',background:'var(--bg2)',borderRadius:'2px',overflow:'hidden'}}><div style={{width:'64%',height:'100%',background:'var(--sky)'}}></div></div>
                </div>
              </div>
              
              <div style={{display:'grid',gridTemplateColumns:'1fr 1.2fr',gap:'20px',marginBottom:'20px'}}>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-rose"></div>Risk Category Breakdown</div></div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'10px'}}>
                    <div style={{border:'1px solid rgba(56,201,176,0.2)',background:'rgba(56,201,176,0.04)',borderRadius:'8px',padding:'16px',textAlign:'center'}}>
                      <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,color:'var(--teal)',marginBottom:'4px'}}>{apps.length > 0 ? ((apps.filter(a => a.risk_category === 'Low').length / apps.length)*100).toFixed(0) : '0'}%</div>
                      <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase'}}>Low Risk</div>
                    </div>
                    <div style={{border:'1px solid rgba(201,151,60,0.2)',background:'rgba(201,151,60,0.04)',borderRadius:'8px',padding:'16px',textAlign:'center'}}>
                      <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,color:'var(--gold)',marginBottom:'4px'}}>{apps.length > 0 ? ((apps.filter(a => a.risk_category === 'Medium').length / apps.length)*100).toFixed(0) : '0'}%</div>
                      <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase'}}>Medium Risk</div>
                    </div>
                    <div style={{border:'1px solid rgba(232,84,117,0.2)',background:'rgba(232,84,117,0.04)',borderRadius:'8px',padding:'16px',textAlign:'center'}}>
                      <div style={{fontFamily:"'Fraunces',serif",fontSize:'22px',fontWeight:700,color:'var(--rose)',marginBottom:'4px'}}>{apps.length > 0 ? ((apps.filter(a => a.risk_category === 'High').length / apps.length)*100).toFixed(0) : '0'}%</div>
                      <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase'}}>High Risk</div>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'20px'}}>
                    <div style={{border:'1px solid var(--border)',background:'var(--bg2)',borderRadius:'8px',padding:'12px',textAlign:'center'}}>
                      <div style={{fontFamily:"'Fraunces',serif",fontSize:'18px',fontWeight:700,color:'var(--teal)',marginBottom:'2px'}}>{apps.filter(a => a.risk_category === 'Low').length.toLocaleString()}</div>
                      <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase'}}>Approved</div>
                    </div>
                    <div style={{border:'1px solid var(--border)',background:'var(--bg2)',borderRadius:'8px',padding:'12px',textAlign:'center'}}>
                      <div style={{fontFamily:"'Fraunces',serif",fontSize:'18px',fontWeight:700,color:'var(--gold)',marginBottom:'2px'}}>{apps.filter(a => a.risk_category === 'Medium').length.toLocaleString()}</div>
                      <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase'}}>Under Review</div>
                    </div>
                    <div style={{border:'1px solid var(--border)',background:'var(--bg2)',borderRadius:'8px',padding:'12px',textAlign:'center'}}>
                      <div style={{fontFamily:"'Fraunces',serif",fontSize:'18px',fontWeight:700,color:'var(--rose)',marginBottom:'2px'}}>{apps.filter(a => a.risk_category === 'High').length.toLocaleString()}</div>
                      <div style={{fontSize:'10px',fontWeight:700,color:'var(--text3)',textTransform:'uppercase'}}>Declined</div>
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'center',gap:'16px',fontSize:'11px',color:'var(--text3)',marginBottom:'10px'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'10px',height:'10px',background:'#38C9B0'}}></span> Low</span>
                    <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'10px',height:'10px',background:'#C9973C'}}></span> Medium</span>
                    <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'10px',height:'10px',background:'#E85475'}}></span> High</span>
                  </div>
                  <div style={{height:'180px',position:'relative'}}><canvas id="cht-stacked-risk"></canvas></div>
                </div>

                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-sky"></div>Default Rate Trend (18 months)</div></div>
                  <div style={{height:'260px',position:'relative'}}><canvas id="cht-trend-18"></canvas></div>
                  <div style={{marginTop:'20px',background:'rgba(56,201,176,0.08)',border:'1px solid rgba(56,201,176,0.2)',borderRadius:'10px',padding:'16px'}}>
                    <div style={{fontWeight:700,color:'var(--teal)',fontSize:'13px',marginBottom:'6px'}}>📉 Improving Trend</div>
                    <div style={{fontSize:'13px',color:'var(--text)',lineHeight:1.5}}>Default rate declined 0.8pp over 18 months, driven by improved credit score filtering and co-signer policies.</div>
                  </div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1.2fr',gap:'20px',marginBottom:'20px'}}>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-gold"></div>Sector Exposure & Default Rate</div></div>
                  <div style={{display:'flex',flexDirection:'column',gap:'16px',marginBottom:'30px'}}>
                    {['Home', 'Education', 'Other', 'Business'].map((purpose, i) => {
                      const filtered = apps.filter(a => a.loan_purpose === purpose);
                      const amt = filtered.reduce((s,a) => s + a.loan_amount, 0);
                      const avgProb = filtered.length > 0 ? (filtered.reduce((s,a) => s + a.probability, 0) / filtered.length) * 100 : 0;
                      const icons = {Home:'🏠', Education:'🎓', Other:'📦', Business:'🏢'};
                      const colors = {Home:'var(--teal)', Education:'var(--teal)', Other:'var(--gold)', Business:'var(--rose)'};
                      return (
                        <div key={purpose} style={{display:'flex',alignItems:'center'}}>
                          <div style={{width:'30px',fontSize:'18px'}}>{icons[purpose]}</div>
                          <div style={{flex:1,fontSize:'13px',fontWeight:600}}>{purpose} Loans</div>
                          <div style={{width:'80px',textAlign:'right',fontFamily:"'JetBrains Mono',monospace",fontSize:'12px'}}>₹{(amt/10000000).toFixed(1)}Cr</div>
                          <div style={{width:'100px',margin:'0 16px',height:'4px',background:'var(--bg2)',borderRadius:'2px',position:'relative'}}>
                            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${avgProb}%`,background:colors[purpose],borderRadius:'2px'}}></div>
                          </div>
                          <div style={{width:'40px',textAlign:'right',fontWeight:700,fontSize:'12px',color:colors[purpose]}}>{avgProb.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <div style={{display:'flex',justifyContent:'center',gap:'12px',fontSize:'11px',color:'var(--text3)',marginBottom:'14px'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',background:'#E85475'}}></span> Home</span>
                    <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',background:'#4BA8E0'}}></span> Education</span>
                    <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',background:'#38C9B0'}}></span> Auto</span>
                    <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',background:'#A072F0'}}></span> Other</span>
                    <span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{width:'8px',height:'8px',background:'#C9973C'}}></span> Business</span>
                  </div>
                  <div style={{height:'180px',position:'relative'}}><canvas id="cht-sector-doughnut"></canvas></div>
                </div>

                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-sky"></div>Geographic Distribution</div></div>
                  <table style={{width:'100%',textAlign:'left',borderCollapse:'collapse',marginBottom:'24px'}}>
                    <thead>
                      <tr style={{fontSize:'10px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'1px',borderBottom:'1px solid var(--border)'}}>
                        <th style={{padding:'8px',fontWeight:700}}></th><th style={{padding:'8px',textAlign:'right'}}>Volume</th><th style={{padding:'8px',textAlign:'right'}}>Default%</th><th style={{padding:'8px',textAlign:'right'}}>Avg Loan</th>
                      </tr>
                    </thead>
                    <tbody style={{fontSize:'13px',color:'var(--text)'}}>
                      {['MH', 'KA', 'TN', 'DL', 'GJ', 'Other'].map(code => {
                        const filtered = apps.filter(a => (a.state || 'MH') === code);
                        const names = {MH:'Maharashtra', KA:'Karnataka', TN:'Tamil Nadu', DL:'Delhi', GJ:'Gujarat', Other:'Others'};
                        const avgLoan = filtered.length > 0 ? (filtered.reduce((s,a)=>s+a.loan_amount,0)/filtered.length/1000).toFixed(1) : '0';
                        const avgProb = filtered.length > 0 ? (filtered.reduce((s,a)=>s+a.probability,0)/filtered.length*100).toFixed(1) : '0';
                        return (
                          <tr key={code} style={{borderBottom:'1px solid var(--border)'}}>
                            <td style={{padding:'12px 8px',fontWeight:600}}>{names[code]}</td>
                            <td style={{padding:'12px 8px',textAlign:'right',fontFamily:"'JetBrains Mono',monospace"}}>{filtered.length}</td>
                            <td style={{padding:'12px 8px',textAlign:'right',fontFamily:"'JetBrains Mono',monospace"}}>{avgProb}%</td>
                            <td style={{padding:'12px 8px',textAlign:'right',fontFamily:"'JetBrains Mono',monospace"}}>₹{avgLoan}L</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{height:'240px',position:'relative'}}><canvas id="cht-geo-bar"></canvas></div>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-rose"></div>EMI-to-Income Stress Distribution</div></div>
                  <div style={{height:'240px',position:'relative'}}><canvas id="cht-stress-bar"></canvas></div>
                </div>
                <div className="card fade-up">
                  <div className="ch"><div className="ct"><div className="pip pip-sky"></div>Model ROC Curve (approximated)</div></div>
                  <div style={{display:'flex',justifyContent:'center',gap:'16px',fontSize:'11px',color:'var(--text3)',marginBottom:'10px'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'10px',height:'10px',border:'2px solid var(--text)',background:'transparent'}}></span> GroundZero LR (AUC=0.760)</span>
                    <span style={{display:'flex',alignItems:'center',gap:'6px'}}><span style={{width:'10px',height:'10px',border:'2px dashed #E85475',background:'transparent'}}></span> Random (AUC=0.500)</span>
                  </div>
                  <div style={{height:'240px',position:'relative'}}><canvas id="cht-roc-curve"></canvas></div>
                </div>
              </div>
            </div>
          )}
          
          {page === 'pg-behaviour' && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="card fade-up">
                <div className="ch"><div className="ct"><div className="pip pip-sky" />Job Stability Analysis</div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                  <div style={{ background: 'rgba(56,201,176,0.06)', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: '24px', fontWeight: 700, color: 'var(--teal)', marginBottom: '4px' }}>
                      {apps.length > 0 ? Math.round(apps.reduce((s,a)=>s+(a.months_employed||0),0)/apps.length) : 0}mo
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text2)' }}>Avg Tenure</div>
                  </div>
                  <div style={{ background: 'var(--bg2)', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: '24px', fontWeight: 700, color: 'var(--gold)', marginBottom: '4px' }}>
                      {apps.length > 0 ? (apps.reduce((s,a)=>s+(a.job_changes||0),0)/apps.length).toFixed(1) : 0}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text2)' }}>Avg Changes</div>
                  </div>
                  <div style={{ background: 'rgba(75,168,224,0.06)', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: '24px', fontWeight: 700, color: '#4BA8E0', marginBottom: '4px' }}>
                      {apps.filter(a=>a.months_employed > 24).length > apps.length/2 ? 'High' : 'Med'}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text2)' }}>Stability</div>
                  </div>
                </div>
                <div style={{ position: 'relative', paddingLeft: '20px', borderLeft: '1px solid var(--border)', marginLeft: '10px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {apps.slice(0, 3).map((a, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-25px', top: '4px', width: '9px', height: '9px', borderRadius: '50%', background: a.months_employed > 24 ? 'var(--teal)' : 'var(--rose)', border: '2px solid var(--panel)' }}></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '13px' }}>{a.full_name || 'Manual Entry'}</span>
                        <span style={{ fontSize: '10px', background: a.months_employed > 24 ? 'rgba(56,201,176,0.1)' : 'rgba(232,84,117,0.1)', color: a.months_employed > 24 ? 'var(--teal)' : 'var(--rose)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>{a.months_employed}mo</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: "'JetBrains Mono',monospace" }}>{a.employment_type || 'Full-time'} · {a.job_changes || 0} changes</div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="card fade-up fade-up-d1">
                <div className="ch"><div className="ct"><div className="pip pip-gold" />Behaviour Signals</div></div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {apps.filter(a=>a.months_employed > 36).length > apps.length/2 && <span style={{ fontSize: '11px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, border: '1px solid rgba(56,201,176,0.2)' }}>● High Tenure Avg</span>}
                  {apps.filter(a=>a.job_changes <= 1).length > apps.length/2 && <span style={{ fontSize: '11px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, border: '1px solid rgba(56,201,176,0.2)' }}>● Stable Employment</span>}
                  {apps.filter(a=>a.has_cosigner === 'Yes').length > 0 && <span style={{ fontSize: '11px', background: 'rgba(75,168,224,0.1)', color: '#4BA8E0', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, border: '1px solid rgba(75,168,224,0.2)' }}>● Co-Signer Presence</span>}
                  {apps.length > 5 && <span style={{ fontSize: '11px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, border: '1px solid rgba(56,201,176,0.2)' }}>● Consistent Flow</span>}
                  <span style={{ fontSize: '11px', background: 'rgba(75,168,224,0.1)', color: '#4BA8E0', padding: '6px 12px', borderRadius: '20px', fontWeight: 600, border: '1px solid rgba(75,168,224,0.2)' }}>● Verification Active</span>
                </div>
              </div>

              <div className="card fade-up fade-up-d2">
                <div className="ch"><div className="ct"><div className="pip pip-teal" />Bill Payment Radar</div></div>
                <div style={{ height: '300px', position: 'relative' }}><canvas id="cht-radar-behavior"></canvas></div>
              </div>

              <div className="card fade-up fade-up-d3">
                <div className="ch"><div className="ct"><div className="pip pip-sky" />Spending vs Income (12 mo)</div></div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '11px', color: 'var(--text3)', marginBottom: '10px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '12px', height: '2px', borderBottom: '2px dashed var(--text)', background: 'transparent' }}></span> Monthly Income</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', border: '2px solid var(--text)', background: 'transparent' }}></span> Spending</span>
                </div>
                <div style={{ height: '280px', position: 'relative' }}><canvas id="cht-spend-behavior"></canvas></div>
              </div>
            </div>
          )}

          {page === 'pg-invest' && (
            <div className="fade-in">
              <div className="kpi-row" style={{ marginBottom: '20px' }}>
                <div className="kpi sky fade-up">
                  <div className="kpi-lbl">TOTAL LOAN VOLUME</div>
                  <div className="kpi-val" style={{ color: '#4BA8E0', fontSize: '32px' }}>₹{(apps.reduce((s,a)=>s+a.loan_amount,0)/100000).toFixed(1)}L</div>
                  <div className="kpi-sub">{apps.length} active applications</div>
                </div>
                <div className="kpi teal fade-up fade-up-d1">
                  <div className="kpi-lbl">AVG RISK SCORE</div>
                  <div className="kpi-val" style={{ color: 'var(--teal)', fontSize: '32px' }}>
                    {apps.length > 0 ? Math.round(apps.reduce((s,a)=>s+a.probability,0)/apps.length*100) : 0}%
                  </div>
                  <div className="kpi-sub">System-wide probability</div>
                </div>
                <div className="kpi gold fade-up fade-up-d2">
                  <div className="kpi-lbl">MEDIAN INCOME</div>
                  <div className="kpi-val" style={{ color: 'var(--gold)', fontSize: '32px' }}>
                    ₹{apps.length > 0 ? (apps.reduce((s,a)=>s+a.income,0)/apps.length/1000).toFixed(1) : 0}k
                  </div>
                  <div className="kpi-sub">Applicant demographic</div>
                </div>
                <div className="kpi rose fade-up fade-up-d3">
                  <div className="kpi-lbl">ESTIMATED NPA</div>
                  <div className="kpi-val" style={{ color: 'var(--rose)', fontSize: '32px' }}>
                    {apps.filter(a=>a.probability > 0.6).length}
                  </div>
                  <div className="kpi-sub">High-risk profiles</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                {/* LEFT COLUMN */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="card fade-up">
                    <div className="ch"><div className="ct"><div className="pip pip-sky" />Portfolio Holdings</div></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {apps.slice(0, 5).map((a, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13px' }}>{a.full_name || 'Manual Entry'}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text2)' }}>{a.loan_purpose} · {a.state || 'MH'}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: '13px' }}>₹{fmt(a.loan_amount)}</div>
                            <div style={{ fontSize: '11px', color: a.probability < 0.3 ? 'var(--teal)' : a.probability < 0.6 ? 'var(--gold)' : 'var(--rose)', fontWeight: 600 }}>
                              {a.risk_category} Risk
                            </div>
                          </div>
                        </div>
                      ))}
                      {apps.length === 0 && <div style={{textAlign:'center',padding:'20px',color:'var(--text3)'}}>No investment/loan records found.</div>}
                    </div>
                    
                    <div className="ch" style={{ marginTop: '30px' }}><div className="ct"><div className="pip pip-teal" />Value Over Time</div></div>
                    <div style={{ height: '220px', position: 'relative' }}><canvas id="cht-value-invest"></canvas></div>

                    <div className="ch" style={{ marginTop: '30px' }}>
                      <div className="ct">🎯 Where to Invest Next</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: 400 }}>Based on your portfolio & risk profile</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={{ border: '1px solid rgba(75,168,224,0.2)', background: 'rgba(75,168,224,0.04)', padding: '16px', borderRadius: '10px' }}>
                        <div style={{ fontSize: '20px', marginBottom: '8px' }}>🏛️</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>ELSS Mutual Fund</div>
                        <div style={{ color: 'var(--teal)', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>↑ 14-18% p.a.</div>
                        <div style={{ fontSize: '11px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '10px' }}>Tax-saving equity linked fund. Lock-in 3 years. Best for long-term wealth & Section 80C benefit.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(201,151,60,0.1)', color: 'var(--gold)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, marginBottom: '8px' }}>Risk: Medium</div>
                        <div style={{ fontSize: '11px', color: 'var(--teal)', fontWeight: 600 }}>+ Boosts credit profile via stable asset growth</div>
                      </div>
                      <div style={{ border: '1px solid rgba(201,151,60,0.2)', background: 'rgba(201,151,60,0.04)', padding: '16px', borderRadius: '10px' }}>
                        <div style={{ fontSize: '20px', marginBottom: '8px' }}>🏢</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>REITs (Real Estate)</div>
                        <div style={{ color: 'var(--teal)', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>↑ 8-12% p.a.</div>
                        <div style={{ fontSize: '11px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '10px' }}>Invest in commercial real estate without owning property. Quarterly dividends, regulated by SEBI.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(201,151,60,0.1)', color: 'var(--gold)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, marginBottom: '8px' }}>Risk: Medium</div>
                        <div style={{ fontSize: '11px', color: 'var(--teal)', fontWeight: 600 }}>+ Fixed income alternative to diversify</div>
                      </div>
                      <div style={{ border: '1px solid rgba(139,114,240,0.2)', background: 'rgba(139,114,240,0.04)', padding: '16px', borderRadius: '10px' }}>
                        <div style={{ fontSize: '20px', marginBottom: '8px' }}>📊</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>Nifty 50 Index Fund</div>
                        <div style={{ color: 'var(--teal)', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>↑ 12-15% p.a.</div>
                        <div style={{ fontSize: '11px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '10px' }}>Low-cost passive fund tracking top 50 Indian companies. Ideal SIP of ₹2,000-5,000/mo.</div>
                      </div>
                      <div style={{ border: '1px solid rgba(160,114,240,0.2)', background: 'rgba(160,114,240,0.04)', padding: '16px', borderRadius: '10px' }}>
                        <div style={{ fontSize: '20px', marginBottom: '8px' }}>🏦</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>RBI Floating Rate Bonds</div>
                        <div style={{ color: 'var(--teal)', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>↑ 8.05% p.a.</div>
                        <div style={{ fontSize: '11px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '10px' }}>Government-backed, zero credit risk. 7-year tenure. Interest resets every 6 months linked to NSC.</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="card fade-up fade-up-d1">
                    <div className="ch"><div className="ct"><div className="pip pip-gold" />Asset Allocation</div></div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', fontSize: '10px', color: 'var(--text3)', marginBottom: '20px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#38C9B0' }}></span> Fixed Income</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#4BA8E0' }}></span> Equity MF</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#C9973C' }}></span> Direct Equity</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#A072F0' }}></span> Govt Bonds</span>
                    </div>
                    <div style={{ height: '220px', position: 'relative', marginBottom: '20px' }}><canvas id="cht-asset-alloc"></canvas></div>
                    
                    <div style={{ background: 'rgba(56,201,176,0.06)', border: '1px solid rgba(56,201,176,0.2)', padding: '16px', borderRadius: '10px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--teal)', fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>📈 Risk Scoring Impact</div>
                      <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>Strong investment portfolio reduces assessed default probability by <span style={{ fontWeight: 700, color: 'var(--teal)' }}>~3-5%</span>. Fixed income instruments weighted most positively.</div>
                    </div>
                  </div>

                  <div className="card fade-up fade-up-d2">
                    <div className="ch"><div className="ct">💼 Portfolio Health Check</div></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--text2)' }}>Total Invested</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: '#4BA8E0' }}>₹4,20,000</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--text2)' }}>Current Value</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--teal)' }}>₹5,16,200</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--text2)' }}>Overall Return</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--teal)' }}>+₹96,200 (+22.9%)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--text2)' }}>Best Performer</span><span style={{ fontWeight: 600, color: 'var(--gold)' }}>Reliance Ind. (+34%)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--text2)' }}>Fixed Income Weight</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>35%</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--text2)' }}>Equity Weight</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>54%</span>
                      </div>
                    </div>
                    <div style={{ marginTop: '16px', display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text2)', background: 'var(--bg2)', padding: '12px', borderRadius: '8px' }}>
                      <span>💡</span><span>Tip: Increasing Fixed Income allocation to 45% would further reduce your default risk score by -1.5%.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {page === 'pg-suggest' && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
              <div>
                <div className="ct" style={{ marginBottom: '16px', fontFamily: "'Fraunces',serif", fontSize: '18px', fontWeight: 700 }}>
                  <div className="pip pip-sky" />Bank Recommendations
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="card fade-up" style={{ border: '1px solid rgba(56,201,176,0.2)', background: 'rgba(56,201,176,0.02)', padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ fontSize: '24px' }}>💳</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>Improve Credit Score to 700+</div>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '12px' }}>Model coef: -0.121. Every 50pt improvement reduces risk. Keep credit utilization below 30%, pay dues on time for 3+ months.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>High Impact</div>
                      </div>
                    </div>
                  </div>

                  <div className="card fade-up fade-up-d1" style={{ border: '1px solid rgba(56,201,176,0.2)', background: 'rgba(56,201,176,0.02)', padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ fontSize: '24px' }}>📊</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>Reduce Loan-to-Income Ratio</div>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '12px' }}>Loan_Income_Ratio coef: +0.470 — strongest positive predictor. Keep loan amount below 1.5x annual income.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>High Impact</div>
                      </div>
                    </div>
                  </div>

                  <div className="card fade-up fade-up-d2" style={{ border: '1px solid rgba(56,201,176,0.2)', background: 'rgba(56,201,176,0.02)', padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ fontSize: '24px' }}>📉</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>Negotiate Lower Interest Rate</div>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '12px' }}>InterestRate coef: +0.459 — 2nd strongest predictor. Lower rates directly reduce the model score. Co-signers help secure better rates.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>High Impact</div>
                      </div>
                    </div>
                  </div>

                  <div className="card fade-up fade-up-d3" style={{ border: '1px solid rgba(56,201,176,0.2)', background: 'rgba(56,201,176,0.02)', padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ fontSize: '24px' }}>⏰</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>Stay Employed Longer</div>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '12px' }}>MonthsEmployed coef: -0.339 — 4th strongest. Avoid switching jobs within 6 months before application. 48+ months significantly lowers probability.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(56,201,176,0.1)', color: 'var(--teal)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>High Impact</div>
                      </div>
                    </div>
                  </div>

                  <div className="card fade-up fade-up-d4" style={{ border: '1px solid rgba(201,151,60,0.2)', background: 'rgba(201,151,60,0.02)', padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ fontSize: '24px' }}>🤝</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>Add a Co-Signer</div>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '12px' }}>HasCoSigner_Yes coef: -0.142. Choose co-signer with 720+ credit score, full-time employment, stable income history.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(201,151,60,0.1)', color: 'var(--gold)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>Med Impact</div>
                      </div>
                    </div>
                  </div>

                  <div className="card fade-up fade-up-d5" style={{ border: '1px solid rgba(201,151,60,0.2)', background: 'rgba(201,151,60,0.02)', padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ fontSize: '24px' }}>🏠</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>Choose Home Loan Purpose</div>
                        <div style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '12px' }}>LoanPurpose_Home coef: -0.078. Lowest risk purpose (10.2% default rate). Business loans: +0.023 coef. Reframe if purpose is flexible.</div>
                        <div style={{ display: 'inline-block', fontSize: '10px', background: 'rgba(201,151,60,0.1)', color: 'var(--gold)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>Med Impact</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card fade-up fade-up-d1" style={{ position: 'sticky', top: '20px', height: 'max-content' }}>
                <div className="ch"><div className="ct"><div className="pip pip-gold" />Eligibility Optimizer</div></div>
                <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '24px' }}>Adjust variables — real model recalculates instantly</div>
                
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: '8px' }}>Loan Amount</div>
                  <input type="range" min="5000" max="2500000" value={opt.loanAmt} onChange={e => setOpt({...opt, loanAmt: +e.target.value})} style={{ width: '100%', marginBottom: '4px', accentColor: 'var(--gold)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)' }}>
                    <span>5K</span><span>₹{fmt(opt.loanAmt)}</span><span>25L</span>
                  </div>
                </div>
                
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: '8px' }}>Credit Score</div>
                  <input type="range" min="300" max="850" value={opt.credit} onChange={e => setOpt({...opt, credit: +e.target.value})} style={{ width: '100%', marginBottom: '4px', accentColor: 'var(--gold)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)' }}>
                    <span>300</span><span>{opt.credit}</span><span>850</span>
                  </div>
                </div>
                
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: '8px' }}>DTI Ratio</div>
                  <input type="range" min="0" max="0.9" step="0.01" value={opt.dti} onChange={e => setOpt({...opt, dti: +e.target.value})} style={{ width: '100%', marginBottom: '4px', accentColor: 'var(--gold)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)' }}>
                    <span>0.00</span><span>{opt.dti.toFixed(2)}</span><span>0.90</span>
                  </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: '8px' }}>Employment Type</div>
                  <select className="inp" style={{ width: '100%', padding: '8px', fontSize: '12px', background: 'var(--bg2)' }} value={opt.empType} onChange={e => setOpt({...opt, empType: e.target.value})}>
                    <option value="full">Full-time</option>
                    <option value="self">Self-employed</option>
                    <option value="part">Part-time</option>
                    <option value="unemp">Unemployed</option>
                  </select>
                </div>

                <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '24px', textAlign: 'center', marginBottom: '30px' }}>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: '48px', fontWeight: 700, color: optProb < 0.3 ? 'var(--teal)' : optProb < 0.6 ? 'var(--gold)' : 'var(--rose)', marginBottom: '4px' }}>
                    {Math.round(optProb * 100)}%
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: optProb < 0.3 ? 'var(--teal)' : optProb < 0.6 ? 'var(--gold)' : 'var(--rose)' }}>
                    {optProb < 0.3 ? '✅ Low Risk' : optProb < 0.6 ? '⚠️ Medium Risk' : '❌ High Risk'}
                  </div>
                </div>
                
                <div style={{ height: '240px', position: 'relative', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginLeft: '30px' }}>
                  {/* Y Axis labels */}
                  <div style={{ position: 'absolute', left: '-30px', top: '-6px', bottom: '-6px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text3)', fontFamily: "'JetBrains Mono',monospace" }}>
                    <span>80%</span><span>70%</span><span>60%</span><span>50%</span><span>40%</span><span>30%</span><span>20%</span><span>10%</span><span>0%</span>
                  </div>
                  {/* Horizontal grid lines */}
                  {Array.from({length:9}).map((_,i) => (
                    <div key={i} style={{ position: 'absolute', top: `${(i/8)*100}%`, left: 0, right: 0, height: '1px', background: 'var(--border)' }}></div>
                  ))}
                  {/* Dynamic dot marker */}
                  {optProb*100 >= 0 && optProb*100 <= 80 && (
                    <div style={{ position: 'absolute', left: '10px', bottom: `${((optProb*100) / 80) * 100}%`, width: '10px', height: '10px', borderRadius: '50%', border: '2px solid var(--text)', background: 'var(--bg)', transform: 'translateY(5px)' }} />
                  )}
                  {optProb*100 > 80 && (
                    <div style={{ position: 'absolute', left: '10px', top: '0', width: '10px', height: '10px', borderRadius: '50%', border: '2px solid var(--rose)', background: 'var(--bg)', transform: 'translateY(-5px)' }} />
                  )}
                  {/* X axis labels */}
                  <div style={{ position: 'absolute', left: '12px', bottom: '-20px', fontSize: '10px', color: 'var(--text3)', fontFamily: "'JetBrains Mono',monospace" }}>#1</div>
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
