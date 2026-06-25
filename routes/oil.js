const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/latest - Mendapatkan data sensor terbaru
router.get('/latest', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM oil_data ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Belum ada data sensor masuk.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error GET /api/latest:', error);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
  }
});

// GET /api/history - Mendapatkan data riwayat dengan filter tanggal dan pencarian status/berat
router.get('/history', async (req, res) => {
  try {
    const { startDate, endDate, search, limit = 100, offset = 0 } = req.query;
    let query = 'SELECT * FROM oil_data WHERE 1=1';
    const params = [];

    // Filter berdasarkan tanggal
    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(`${endDate} 23:59:59`);
    }

    // Pencarian berdasarkan status atau berat
    if (search) {
      query += ' AND (status LIKE ? OR CAST(weight AS CHAR) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Urutan terbaru
    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const [rows] = await pool.query(query, params);
    
    // Hitung total untuk meta-data
    let countQuery = 'SELECT COUNT(*) as total FROM oil_data WHERE 1=1';
    const countParams = [];
    if (startDate) {
      countQuery += ' AND timestamp >= ?';
      countParams.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      countQuery += ' AND timestamp <= ?';
      countParams.push(`${endDate} 23:59:59`);
    }
    if (search) {
      countQuery += ' AND (status LIKE ? OR CAST(weight AS CHAR) LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    
    const [[countResult]] = await pool.query(countQuery, countParams);

    res.json({
      total: countResult.total,
      data: rows
    });
  } catch (error) {
    console.error('Error GET /api/history:', error);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
  }
});

module.exports = router;
