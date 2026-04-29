/* ═══════════════════════════════════════════════
   REAL MODEL — LogisticRegression coefficients
   from main.ipynb | ROC-AUC: 0.760
   Ported directly from referal.html
   ═══════════════════════════════════════════════ */

export const MODEL = {
  features: ['Age','Income','LoanAmount','CreditScore','MonthsEmployed','NumCreditLines','InterestRate','LoanTerm','DTIRatio','Education_High School',"Education_Master's",'Education_PhD','EmploymentType_Part-time','EmploymentType_Self-employed','EmploymentType_Unemployed','MaritalStatus_Married','MaritalStatus_Single','HasMortgage_Yes','HasDependents_Yes','LoanPurpose_Business','LoanPurpose_Education','LoanPurpose_Home','LoanPurpose_Other','HasCoSigner_Yes','Loan_Income_Ratio','Estimated_EMI','EMI_Income_Ratio','Income_Group_Medium','Income_Group_High'],
  coef: [-0.5993,-0.0016,-0.0153,-0.1215,-0.3385,0.1017,0.4587,0.0179,0.0,0.0316,-0.0577,-0.0747,0.1254,0.1098,0.2008,-0.1080,-0.0326,-0.0743,-0.1232,0.0226,-0.0004,-0.0782,-0.0049,-0.1422,0.4700,0.0304,-0.0106,0.0044,0.0124],
  intercept: -2.3874,
  mean: [43.489,82506.228,127547.496,574.076,59.509,2.502,12.992,36.011,0.0,0.2499,0.2485,0.2496,0.2519,0.2492,0.2496,0.3339,0.3325,0.5000,0.5002,0.2006,0.2000,0.2001,0.1999,0.5003,2.1757,4843.399,0.0826,0.3337,0.3333],
  scale: [14.995,38952.008,70854.891,158.877,34.645,1.117,6.630,16.945,1.0,0.4329,0.4322,0.4328,0.4341,0.4325,0.4328,0.4716,0.4711,0.5000,0.5000,0.4005,0.4000,0.4001,0.3999,0.5000,2.1748,4427.158,0.1112,0.4715,0.4714],
  q33: 59989,
  q66: 105058.782
};

export const sigmoid = z => 1 / (1 + Math.exp(-z));

export function buildFV(d, f) {
  const lir = d.income > 0 ? d.loanAmt / d.income : 2.18;
  const emi = d.loanAmt / Math.max(d.term, 1);
  const er = d.income > 0 ? emi / d.income : 0.083;
  return [
    d.age, d.income, d.loanAmt, d.credit, d.empl, d.lines, d.rate, d.term, d.dti,
    d.edu === 'hs' ? 1 : 0, d.edu === 'mast' ? 1 : 0, d.edu === 'phd' ? 1 : 0,
    d.empType === 'part' ? 1 : 0, d.empType === 'self' ? 1 : 0, d.empType === 'unemployed' ? 1 : 0,
    d.marital === 'married' ? 1 : 0, d.marital === 'single' ? 1 : 0,
    f.mort === 'Y' ? 1 : 0, f.dep === 'Y' ? 1 : 0,
    d.purpose === 'business' ? 1 : 0, d.purpose === 'education' ? 1 : 0, d.purpose === 'home' ? 1 : 0, d.purpose === 'other' ? 1 : 0,
    f.co === 'Y' ? 1 : 0, lir, emi, er,
    (d.income > MODEL.q33 && d.income <= MODEL.q66) ? 1 : 0, d.income > MODEL.q66 ? 1 : 0
  ];
}

export function calcRisk(d, f) {
  const x = buildFV(d, f);
  let z = MODEL.intercept;
  for (let i = 0; i < MODEL.features.length; i++) {
    z += MODEL.coef[i] * ((x[i] - MODEL.mean[i]) / MODEL.scale[i]);
  }
  return sigmoid(z);
}

export function calcEMI(p, r, t) {
  const rate = parseFloat(r);
  const mr = rate / 12 / 100;
  if (mr <= 0) return p / t;
  return (p * mr * Math.pow(1 + mr, t)) / (Math.pow(1 + mr, t) - 1);
}

export function buildSched(p, r, t) {
  const emi = calcEMI(p, r, t);
  const mr = parseFloat(r) / 12 / 100;
  
  // Calculate strict totals based on mathematical EMI
  const totalPay = emi * t;
  const totalInt = Math.max(0, totalPay - p);
  
  let bal = p;
  const rows = [];
  
  for (let i = 1; i <= t; i++) {
    const int = bal * mr;
    let prn = emi - int;
    
    // Adjust last payment to exactly clear balance
    if (i === t) {
      prn = bal;
    }
    
    bal = Math.max(0, bal - prn);
    rows.push({ m: i, emi: prn + int, p: prn, i: int, bal });
  }
  
  return { rows, emi, tP: p, tI: totalInt, tPay: totalPay };
}

export const fmt = (n) => (+n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtK = (n) => {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(0) + 'K';
  return '₹' + n;
};
