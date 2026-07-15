CREATE DATABASE flood_db;
GO
USE flood_db;

CREATE TABLE users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(100) UNIQUE,
  password VARCHAR(255),
  role VARCHAR(20),
  created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE predictions (
  id INT IDENTITY(1,1) PRIMARY KEY,
  location VARCHAR(100),
  rainfall FLOAT,
  river_level FLOAT,
  temperature FLOAT,
  input_data NVARCHAR(MAX),
  risk VARCHAR(10),
  confidence FLOAT,
  explanation TEXT,
  user_email VARCHAR(100),
  created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE alerts (
  id INT IDENTITY(1,1) PRIMARY KEY,
  message TEXT,
  risk_level VARCHAR(10),
  location VARCHAR(100),
  status VARCHAR(20),
  assigned_worker VARCHAR(100),
  linked_rescue_op_id INT,
  created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE shelters (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name VARCHAR(100),
  address TEXT,
  capacity INT,
  contact VARCHAR(50),
  latitude FLOAT,
  longitude FLOAT,
  created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE hospitals (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name VARCHAR(100),
  address TEXT,
  contact VARCHAR(50),
  services TEXT,
  latitude FLOAT,
  longitude FLOAT,
  created_at DATETIME DEFAULT GETDATE()
);

-- FR-05: Rescue Coordination
CREATE TABLE rescue_operations (
  id INT IDENTITY(1,1) PRIMARY KEY,
  title VARCHAR(150),
  location VARCHAR(100),
  risk_level VARCHAR(10),        -- Low / Medium / High (drives priority)
  assigned_team VARCHAR(100),
  status VARCHAR(20) DEFAULT 'Pending',  -- Pending / Active / Completed
  notes TEXT,
  created_at DATETIME DEFAULT GETDATE(),
  updated_at DATETIME DEFAULT GETDATE(),
  completed_at DATETIME NULL
);

-- FR-06: Community Engagement (moved off browser localStorage onto the server)
CREATE TABLE community_reports (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tracking_id VARCHAR(20) UNIQUE,
  location VARCHAR(150),
  region VARCHAR(50),
  incident_type VARCHAR(50),
  severity VARCHAR(10),
  status VARCHAR(20) DEFAULT 'Submitted',  -- Submitted / Under Review / Action Taken / Resolved
  author_name VARCHAR(100),
  author_email VARCHAR(100),
  description TEXT,
  contact VARCHAR(50),
  image_url TEXT,
  notes TEXT,
  linked_rescue_op_id INT NULL,  -- set when status moves to 'Action Taken' (FR06-04 <-> FR-05 link)
  created_at DATETIME DEFAULT GETDATE()
);


select * from predictions;

SELECT name FROM sys.tables;

ALTER TABLE users ADD is_verified BIT DEFAULT 0;
ALTER TABLE users ADD otp VARCHAR(10);
ALTER TABLE predictions ADD user_id INT;

ALTER TABLE predictions
ADD input_data NVARCHAR(MAX);




-- FR-04: Interactive Map — blocked roads
CREATE TABLE blocked_roads (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name VARCHAR(150),
  location VARCHAR(150),
  latitude FLOAT,
  longitude FLOAT,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'Blocked',  -- Blocked / Cleared
  created_at DATETIME DEFAULT GETDATE()
);

-- ===== Migration for existing databases (run once if shelters/hospitals already exist) =====
-- ALTER TABLE alerts ADD location VARCHAR(100);
-- ALTER TABLE alerts ADD status VARCHAR(20);
-- ALTER TABLE alerts ADD assigned_worker VARCHAR(100);
-- ALTER TABLE alerts ADD linked_rescue_op_id INT;
-- ALTER TABLE predictions ADD user_email VARCHAR(100);
-- ALTER TABLE shelters ADD latitude FLOAT;
-- ALTER TABLE shelters ADD longitude FLOAT;
-- ALTER TABLE shelters ADD created_at DATETIME DEFAULT GETDATE();
-- ALTER TABLE hospitals ADD services TEXT;
-- ALTER TABLE hospitals ADD latitude FLOAT;
-- ALTER TABLE hospitals ADD longitude FLOAT;
-- ALTER TABLE hospitals ADD created_at DATETIME DEFAULT GETDATE();
-- ALTER TABLE alerts ADD location VARCHAR(100);
-- (rescue_operations and community_reports are new tables — CREATE TABLE statements above)


