import os
import logging
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import OperationalError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get DATABASE_URL — Railway provides 'postgres://', SQLAlchemy needs 'postgresql://'
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:Stuti180207@127.0.0.1:5432/GroundZero')
DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

Base = declarative_base()

class PredictionRecord(Base):
    """Database model for storing loan predictions."""
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String)
    email = Column(String)
    state = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Input features
    age = Column(Integer)
    income = Column(Float)
    loan_amount = Column(Float)
    credit_score = Column(Integer)
    months_employed = Column(Integer)
    num_credit_lines = Column(Integer)
    interest_rate = Column(Float)
    loan_term = Column(Integer)
    dti_ratio = Column(Float)
    education = Column(String)
    employment_type = Column(String)
    marital_status = Column(String)
    has_mortgage = Column(String)
    has_dependents = Column(String)
    loan_purpose = Column(String)
    has_cosigner = Column(String)
    
    # New Fields
    has_existing_loan = Column(String)
    existing_bank = Column(String)
    existing_rate = Column(Float)
    existing_purpose = Column(String)
    job_changes = Column(Integer, default=0)
    
    # Output features
    prediction = Column(Integer)
    default_probability = Column(Float)
    risk_category = Column(String)

class User(Base):
    """Database model for registered users."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String)
    last_name = Column(String)
    email = Column(String, unique=True, index=True)
    password = Column(String)
    role = Column(String, default='borrower') # 'bank' or 'borrower'
    created_at = Column(DateTime, default=datetime.utcnow)

# Initialize Engine and Session — PostgreSQL ONLY
engine = None
SessionLocal = None
DB_AVAILABLE = False

try:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,       # Test connection before using
        pool_recycle=300,         # Recycle connections every 5 min
        connect_args={}
    )
    with engine.connect() as conn:
        logger.info("[OK] Successfully connected to PostgreSQL database.")
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    DB_AVAILABLE = True

except OperationalError as e:
    logger.error(f"[DB ERROR] Cannot connect to PostgreSQL: {e}")
    logger.error("[FATAL] PostgreSQL is required. No SQLite fallback.")
    DB_AVAILABLE = False

except Exception as e:
    logger.error(f"[DB ERROR] Unexpected error connecting to PostgreSQL: {e}")
    logger.error("[FATAL] PostgreSQL is required. No SQLite fallback.")
    DB_AVAILABLE = False

def get_db():
    """Return an open database session, or None if DB is unavailable."""
    if not DB_AVAILABLE or SessionLocal is None:
        return None
    return SessionLocal()
