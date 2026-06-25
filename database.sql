-- Create database if it does not exist
CREATE DATABASE IF NOT EXISTS smart_oil_tracker;
USE smart_oil_tracker;

-- Create table oil_data
CREATE TABLE IF NOT EXISTS oil_data (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    weight FLOAT NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    speed FLOAT DEFAULT 0.0,
    satellite INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'OFFLINE',
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
