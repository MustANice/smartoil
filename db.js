const mysql = require('mysql2/promise');
require('dotenv').config();

// Create the connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smart_oil_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection and auto-create DB/table if not exists
async function checkDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('✓ Database MySQL berhasil terhubung.');
    
    // Auto-migration: Cek jika tabel sudah ada tapi menggunakan struktur lama (misal: kolom 'speed' tidak ada)
    try {
      const [tableExists] = await connection.query("SHOW TABLES LIKE 'oil_data'");
      if (tableExists.length > 0) {
        const [columns] = await connection.query("SHOW COLUMNS FROM oil_data LIKE 'speed'");
        if (columns.length === 0) {
          console.log('⚠️  Struktur tabel lama terdeteksi (kolom "speed" tidak ditemukan). Memperbarui tabel...');
          // Hapus foreign key references jika ada (seperti tabel 'devices' dari skema lama)
          await connection.query('SET FOREIGN_KEY_CHECKS = 0');
          await connection.query('DROP TABLE IF EXISTS devices');
          await connection.query('DROP TABLE IF EXISTS oil_data');
          await connection.query('SET FOREIGN_KEY_CHECKS = 1');
          console.log('✓ Tabel lama berhasil dibersihkan.');
        }
      }
    } catch (e) {
      console.warn('Peringatan saat memeriksa tabel lama:', e.message);
    }
    
    // Buat tabel baru dengan struktur lengkap
    await connection.query(`
      CREATE TABLE IF NOT EXISTS oil_data (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        weight FLOAT NOT NULL,
        latitude DOUBLE NOT NULL,
        longitude DOUBLE NOT NULL,
        speed FLOAT DEFAULT 0.0,
        satellite INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'ONLINE',
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    
    connection.release();
  } catch (error) {
    console.error('✗ Gagal terhubung ke database MySQL:', error.message);
    console.error('Harap pastikan XAMPP MySQL atau service MySQL Anda sudah berjalan.');
  }
}

module.exports = {
  pool,
  checkDatabase
};
