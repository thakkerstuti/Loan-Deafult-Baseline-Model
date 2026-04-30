import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required for migration")

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Checking for job_changes column...")
        try:
            conn.execute(text("ALTER TABLE predictions ADD COLUMN job_changes INTEGER DEFAULT 0"))
            conn.commit()
            print("[OK] Column 'job_changes' added successfully.")
        except Exception as e:
            if "already exists" in str(e):
                print("[INFO] Column 'job_changes' already exists.")
            else:
                print(f"[ERROR] Migration failed: {e}")

if __name__ == "__main__":
    migrate()
