"""
Flask REST API for the Loan Default Prediction Model.
Provides endpoints for single prediction, batch prediction, 
model info, and feature importance.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import os
from datetime import datetime

from database import get_db, PredictionRecord, User

# --- App Setup ---
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')
app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')

def get_cors_origins():
    configured = os.getenv('CORS_ORIGINS') or os.getenv('FRONTEND_URL') or ''
    origins = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:5176',
        'http://localhost:5177',
        'http://localhost:5178',
        'http://localhost:5179',
        'http://localhost:5180',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
        'http://127.0.0.1:5176',
        'http://127.0.0.1:5177',
        'http://127.0.0.1:5178',
        'https://groundzero-tawny.vercel.app',
        'https://loan-default-backend-production.up.railway.app',
    ]
    origins.extend(origin.strip().rstrip('/') for origin in configured.split(',') if origin.strip())
    return sorted(set(origins))


# Configure CORS for frontend communication
CORS(app, resources={
    r"/api/*": {
        "origins": get_cors_origins(),
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True
    }
})

# --- Load Model Artifacts ---
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'model_artifacts')


def load_model():
    """Load model artifacts from disk."""
    model = joblib.load(os.path.join(MODEL_DIR, 'logistic_model.pkl'))
    scaler = joblib.load(os.path.join(MODEL_DIR, 'scaler.pkl'))
    feature_names = joblib.load(os.path.join(MODEL_DIR, 'feature_names.pkl'))
    metadata = joblib.load(os.path.join(MODEL_DIR, 'metadata.pkl'))
    return model, scaler, feature_names, metadata


try:
    model, scaler, feature_names, metadata = load_model()
    MODEL_LOADED = True
    print("[OK] Model artifacts loaded successfully.")
except Exception as e:
    MODEL_LOADED = False
    print(f"[ERROR] Failed to load model: {e}")
    print("  Run train_model.py first to generate model artifacts.")


# --- Risk Category Assignment ---
def get_risk_category(probability):
    """Assign risk category based on default probability."""
    if probability < 0.3:
        return 'Low'
    elif probability < 0.6:
        return 'Medium'
    else:
        return 'High'


def get_risk_color(category):
    """Return color for risk category."""
    colors = {'Low': '#10b981', 'Medium': '#f59e0b', 'High': '#ef4444'}
    return colors.get(category, '#6b7280')


# --- Feature Preparation ---
def prepare_features(data):
    """
    Take raw user input and transform it into model-ready features.
    This mirrors the preprocessing done during training.
    """
    # Create a DataFrame from input
    df = pd.DataFrame([data])

    # Ensure numeric types
    numeric_fields = ['Age', 'Income', 'LoanAmount', 'CreditScore',
                      'MonthsEmployed', 'NumCreditLines', 'InterestRate',
                      'LoanTerm', 'DTIRatio']
    for field in numeric_fields:
        df[field] = pd.to_numeric(df[field], errors='coerce')

    invalid_numeric = [
        field for field in numeric_fields
        if pd.isna(df[field].iloc[0]) or not np.isfinite(df[field].iloc[0])
    ]
    if invalid_numeric:
        raise ValueError(f"Invalid numeric values for: {', '.join(invalid_numeric)}")

    if df['Income'].iloc[0] <= 0:
        raise ValueError("Income must be greater than 0")
    if df['LoanAmount'].iloc[0] <= 0:
        raise ValueError("LoanAmount must be greater than 0")
    if df['LoanTerm'].iloc[0] <= 0:
        raise ValueError("LoanTerm must be greater than 0")
    if df['DTIRatio'].iloc[0] < 0 or df['DTIRatio'].iloc[0] > 1:
        raise ValueError("DTIRatio must be between 0 and 1")

    # Feature Engineering
    df['Loan_Income_Ratio'] = df['LoanAmount'] / df['Income']
    df['Estimated_EMI'] = df['LoanAmount'] / df['LoanTerm']
    df['EMI_Income_Ratio'] = df['Estimated_EMI'] / df['Income']

    # Income Group
    income = df['Income'].iloc[0]
    if income <= 40000:
        income_group = 'Low Income'
    elif income <= 80000:
        income_group = 'Medium Income'
    else:
        income_group = 'High Income'

    # One-hot encode categorical variables
    categorical_mappings = {
        'Education': ["High School", "Master's", "PhD"],
        'EmploymentType': ["Part-time", "Self-employed", "Unemployed"],
        'MaritalStatus': ["Married", "Single"],
        'HasMortgage': ["Yes"],
        'HasDependents': ["Yes"],
        'LoanPurpose': ["Business", "Education", "Home", "Other"],
        'HasCoSigner': ["Yes"],
        'Income_Group': ["Medium Income", "High Income"]
    }

    # Initialize all one-hot columns to 0
    for col, categories in categorical_mappings.items():
        for cat in categories:
            col_name = f"{col}_{cat}"
            df[col_name] = 0

    # Set the correct one-hot values
    for col in ['Education', 'EmploymentType', 'MaritalStatus', 'LoanPurpose']:
        val = data.get(col, '')
        col_name = f"{col}_{val}"
        if col_name in df.columns:
            df[col_name] = 1

    for col in ['HasMortgage', 'HasDependents', 'HasCoSigner']:
        if data.get(col, 'No') == 'Yes':
            df[f"{col}_Yes"] = 1

    # Income group encoding
    if income_group == 'Medium Income':
        df['Income_Group_Medium Income'] = 1
    elif income_group == 'High Income':
        df['Income_Group_High Income'] = 1

    # Drop original categorical columns
    cols_to_drop = ['Education', 'EmploymentType', 'MaritalStatus',
                    'HasMortgage', 'HasDependents', 'LoanPurpose',
                    'HasCoSigner', 'Income_Group']
    for col in cols_to_drop:
        if col in df.columns:
            df = df.drop(columns=[col])

    # Reorder to match training features
    for feat in feature_names:
        if feat not in df.columns:
            df[feat] = 0

    df = df[feature_names]

    return df


# ========================
# API ENDPOINTS
# ========================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'model_loaded': MODEL_LOADED,
        'version': '1.0.0'
    })


# --- Auth Routes ---
@app.route('/api/signup', methods=['POST'])
def signup():
    data = request.json
    db = get_db()
    if not db: return jsonify({'error': 'DB offline'}), 500
    
    try:
        # Check if user exists
        existing = db.query(User).filter(User.email == data.get('email')).first()
        if existing: return jsonify({'error': 'User already exists'}), 400
        
        new_user = User(
            first_name=data.get('first_name'),
            last_name=data.get('last_name'),
            email=data.get('email'),
            password=data.get('password'), # In production, hash this!
            role=data.get('role', 'borrower')
        )
        db.add(new_user)
        db.commit()
        return jsonify({'message': 'Account created successfully'})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    db = get_db()
    if not db: return jsonify({'error': 'DB offline'}), 500
    
    try:
        user = db.query(User).filter(User.email == data.get('email')).first()
        if not user: return jsonify({'error': 'Account not found. Please create one.'}), 404
        if user.password != data.get('password'): return jsonify({'error': 'Invalid password'}), 401
        
        return jsonify({
            'first': user.first_name,
            'last': user.last_name,
            'email': user.email,
            'type': user.role
        })
    finally:
        db.close()


@app.route('/api/predict', methods=['POST'])
def predict():
    """Single loan default prediction."""
    if not MODEL_LOADED:
        return jsonify({'error': 'Model not loaded. Run train_model.py first.'}), 503

    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No input data provided'}), 400

        # Validate required fields
        required_fields = ['Age', 'Income', 'LoanAmount', 'CreditScore',
                           'MonthsEmployed', 'NumCreditLines', 'InterestRate',
                           'LoanTerm', 'DTIRatio', 'Education', 'EmploymentType',
                           'MaritalStatus', 'HasMortgage', 'HasDependents',
                           'LoanPurpose', 'HasCoSigner']

        missing = [f for f in required_fields if f not in data]
        if missing:
            return jsonify({'error': f'Missing fields: {", ".join(missing)}'}), 400

        # Prepare features
        try:
            features_df = prepare_features(data)
        except ValueError as validation_error:
            return jsonify({'error': str(validation_error)}), 400
        features_scaled = scaler.transform(features_df)

        # Predict
        probability = model.predict_proba(features_scaled)[0][1]
        prediction = int(probability >= 0.5)
        risk_category = get_risk_category(probability)

        # Get feature contributions (coefficient × feature value)
        coefficients = model.coef_[0]
        feature_values = features_scaled[0]
        contributions = coefficients * feature_values
        top_factors_idx = np.argsort(np.abs(contributions))[::-1][:5]

        top_risk_factors = []
        for idx in top_factors_idx:
            factor_name = feature_names[idx]
            factor_impact = float(contributions[idx])
            top_risk_factors.append({
                'feature': factor_name,
                'impact': factor_impact,
                'direction': 'increases risk' if factor_impact > 0 else 'decreases risk'
            })

        response = {
            'prediction': prediction,
            'prediction_label': 'Default' if prediction == 1 else 'Non-Default',
            'default_probability': round(float(probability), 4),
            'risk_category': risk_category,
            'risk_color': get_risk_color(risk_category),
            'confidence': round(float(max(probability, 1 - probability)), 4),
            'top_risk_factors': top_risk_factors,
            'input_summary': {
                'loan_income_ratio': round(float(data['LoanAmount']) / float(data['Income']), 2),
                'estimated_emi': round(float(data['LoanAmount']) / float(data['LoanTerm']), 2),
            }
        }

        # Always INSERT a new record for each submission — never update
        db = get_db()
        if db:
            try:
                from sqlalchemy import text
                full_name = data.get('FullName', 'Anonymous').strip()
                email = data.get('Email', 'anonymous@example.com').strip()
                job_changes = int(data.get('JobChanges', 0))

                print(f"\n--- DB INSERT ---")
                print(f"Inserting new record: Name='{full_name}', Email='{email}'")

                db.execute(text("""
                    INSERT INTO predictions
                        (full_name, email, state, created_at,
                         age, income, loan_amount, credit_score,
                         months_employed, num_credit_lines, interest_rate,
                         loan_term, dti_ratio, education, employment_type,
                         marital_status, has_mortgage, has_dependents,
                         loan_purpose, has_cosigner, has_existing_loan,
                         existing_bank, existing_rate, existing_purpose,
                         job_changes, prediction, default_probability, risk_category)
                    VALUES
                        (:full_name, :email, :state, NOW(),
                         :age, :income, :loan_amount, :credit_score,
                         :months_employed, :num_credit_lines, :interest_rate,
                         :loan_term, :dti_ratio, :education, :employment_type,
                         :marital_status, :has_mortgage, :has_dependents,
                         :loan_purpose, :has_cosigner, :has_existing_loan,
                         :existing_bank, :existing_rate, :existing_purpose,
                         :job_changes, :prediction, :default_probability, :risk_category)
                """), {
                    'full_name': full_name,
                    'email': email,
                    'state': str(data.get('State', 'MH')),
                    'age': int(data.get('Age', 0)),
                    'income': float(data.get('Income', 0)),
                    'loan_amount': float(data.get('LoanAmount', 0)),
                    'credit_score': int(data.get('CreditScore', 0)),
                    'months_employed': int(data.get('MonthsEmployed', 0)),
                    'num_credit_lines': int(data.get('NumCreditLines', 0)),
                    'interest_rate': float(data.get('InterestRate', 0)),
                    'loan_term': int(data.get('LoanTerm', 0)),
                    'dti_ratio': float(data.get('DTIRatio', 0)),
                    'education': str(data.get('Education', '')),
                    'employment_type': str(data.get('EmploymentType', '')),
                    'marital_status': str(data.get('MaritalStatus', '')),
                    'has_mortgage': str(data.get('HasMortgage', '')),
                    'has_dependents': str(data.get('HasDependents', '')),
                    'loan_purpose': str(data.get('LoanPurpose', '')),
                    'has_cosigner': str(data.get('HasCoSigner', '')),
                    'has_existing_loan': str(data.get('HasExistingLoan', 'No')),
                    'existing_bank': str(data.get('ExistingBank', '')),
                    'existing_rate': float(data.get('ExistingRate', 0)),
                    'existing_purpose': str(data.get('ExistingPurpose', '')),
                    'job_changes': job_changes,
                    'prediction': prediction,
                    'default_probability': float(probability),
                    'risk_category': risk_category,
                })
                db.commit()
                print(f"New record inserted successfully for {email}.\n")
            except Exception as db_e:
                import traceback
                print(f"[DB ERROR] Failed to save prediction: {db_e}")
                traceback.print_exc()
                db.rollback()
            finally:
                db.close()

        return jsonify(response)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/applications', methods=['GET'])
def get_applications():
    db = get_db()
    if not db: return jsonify({'error': 'DB offline'}), 500
    
    try:
        records = db.query(PredictionRecord).order_by(PredictionRecord.created_at.desc()).all()
        result = []
        for r in records:
            result.append({
                'id': r.id,
                'full_name': r.full_name, # Standardized name
                'email': r.email,
                'state': r.state,
                'age': r.age,
                'income': r.income,
                'loan_amount': r.loan_amount,
                'credit_score': r.credit_score,
                'loan_purpose': r.loan_purpose,
                'risk_category': r.risk_category,
                'probability': r.default_probability,
                'created_at': r.created_at.isoformat() if r.created_at else None,
                'has_existing_loan': r.has_existing_loan,
                'existing_bank': r.existing_bank,
                'existing_rate': r.existing_rate,
                'existing_purpose': r.existing_purpose,
                'dti': r.dti_ratio,
                'term': r.loan_term,
                'interest_rate': r.interest_rate,
                'employment_type': r.employment_type,
                'months_employed': r.months_employed,
                'job_changes': r.job_changes,
                'has_cosigner': r.has_cosigner
            })
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Database query failed: {str(e)}'}), 500
    finally:
        db.close()


@app.route('/api/my-applications', methods=['GET'])
def get_my_applications():
    email = request.args.get('email')
    if not email:
        return jsonify({'error': 'Email required'}), 400
    db = get_db()
    if not db: return jsonify({'error': 'DB offline'}), 500
    try:
        records = db.query(PredictionRecord).filter(PredictionRecord.email == email).order_by(PredictionRecord.created_at.desc()).all()
        result = []
        for r in records:
            result.append({
                'id': r.id, 'full_name': r.full_name, 'email': r.email, 'state': r.state,
                'age': r.age, 'income': r.income, 'loan_amount': r.loan_amount, 'credit_score': r.credit_score,
                'loan_purpose': r.loan_purpose, 'risk_category': r.risk_category, 'probability': r.default_probability,
                'created_at': r.created_at.isoformat() if r.created_at else None,
                'has_existing_loan': r.has_existing_loan, 'existing_bank': r.existing_bank,
                'existing_rate': r.existing_rate, 'existing_purpose': r.existing_purpose,
                'dti': r.dti_ratio, 'term': r.loan_term, 'interest_rate': r.interest_rate,
                'employment_type': r.employment_type, 'months_employed': r.months_employed,
                'job_changes': r.job_changes, 'has_cosigner': r.has_cosigner,
                'education': r.education, 'marital_status': r.marital_status,
                'has_mortgage': r.has_mortgage, 'has_dependents': r.has_dependents,
                'prediction': r.prediction
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@app.route('/api/model-info', methods=['GET'])
def model_info():
    """Return model metadata and feature importance."""
    if not MODEL_LOADED:
        return jsonify({'error': 'Model not loaded'}), 503

    # Feature importance from coefficients
    coefficients = model.coef_[0]
    importance = []
    for i, name in enumerate(feature_names):
        importance.append({
            'feature': name,
            'coefficient': round(float(coefficients[i]), 6),
            'abs_coefficient': round(float(abs(coefficients[i])), 6)
        })

    importance.sort(key=lambda x: x['abs_coefficient'], reverse=True)

    return jsonify({
        'model_type': 'Logistic Regression',
        'roc_auc': round(metadata['roc_auc'], 4),
        'n_features': metadata['n_features'],
        'n_training_samples': metadata['n_training_samples'],
        'n_test_samples': metadata['n_test_samples'],
        'default_rate': round(metadata['default_rate'], 4),
        'feature_importance': importance
    })


@app.route('/api/feature-options', methods=['GET'])
def feature_options():
    """Return valid options for categorical features."""
    return jsonify({
        'Education': ["Bachelor's", "High School", "Master's", "PhD"],
        'EmploymentType': ["Full-time", "Part-time", "Self-employed", "Unemployed"],
        'MaritalStatus': ["Divorced", "Married", "Single"],
        'HasMortgage': ["Yes", "No"],
        'HasDependents': ["Yes", "No"],
        'LoanPurpose': ["Auto", "Business", "Education", "Home", "Other"],
        'HasCoSigner': ["Yes", "No"],
        'numeric_ranges': {
            'Age': {'min': 18, 'max': 80, 'step': 1},
            'Income': {'min': 10000, 'max': 200000, 'step': 1000},
            'LoanAmount': {'min': 1000, 'max': 500000, 'step': 1000},
            'CreditScore': {'min': 300, 'max': 850, 'step': 1},
            'MonthsEmployed': {'min': 0, 'max': 360, 'step': 1},
            'NumCreditLines': {'min': 0, 'max': 10, 'step': 1},
            'InterestRate': {'min': 1.0, 'max': 30.0, 'step': 0.1},
            'LoanTerm': {'min': 6, 'max': 60, 'step': 6},
            'DTIRatio': {'min': 0.0, 'max': 1.0, 'step': 0.01}
        }
    })


# --- Serve Frontend ---
@app.route('/')
def serve_frontend():
    """Serve the frontend index.html."""
    return app.send_static_file('index.html')


# --- Run Server ---
if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("  Loan Default Prediction API")
    print("  http://localhost:5000")
    print("=" * 60 + "\n")
    app.run(debug=True, port=5000, use_reloader=False)
