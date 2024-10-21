const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose(); 
const bodyParser = require('body-parser'); 


const app = express(); 

app.use(bodyParser.json());

// Open the existing database
const db = new sqlite3.Database('transactions.db');

// Fetch data and seed the existing database
const initializeDB = async () => {
    const url = 'https://s3.amazonaws.com/roxiler.com/product_transaction.json';
    const response = await axios.get(url);
    const data = response.data;

    // Insert seed data
    const stmt = db.prepare(`
        INSERT INTO transactions (title, description, price, dateOfSale, category, sold)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    data.forEach((item) => {
        stmt.run(item.title, item.description, item.price, item.dateOfSale, item.category, item.sold);
    });

    stmt.finalize();
};

// Initialize the database with seed data
initializeDB(); 

// API 1: List Transactions with search and pagination
app.get('/transactions', (req, res) => {
    const { search = '', page = 1, perPage = 10, month } = req.query;
    const offset = (page - 1) * perPage;

    let query = `SELECT * FROM transactions WHERE strftime('%m', dateOfSale) = ?`;
    let params = [month];

    if (search) {
        query += ` AND (title LIKE ? OR description LIKE ? OR price = ?)`;
        params.push(`%${search}%`, `%${search}%`, search);
    }

    query += ` LIMIT ? OFFSET ?`;
    params.push(perPage, offset);

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
}); 




// API 2: Statistics (total sales, sold items, not sold items)
app.get('/statistics', (req, res) => {
    const { month } = req.query;

    db.get(`
        SELECT
            SUM(price) AS totalSales,
            COUNT(CASE WHEN sold = 1 THEN 1 END) AS soldItems,
            COUNT(CASE WHEN sold = 0 THEN 1 END) AS notSoldItems
        FROM transactions
        WHERE strftime('%m', dateOfSale) = ?
    `, [month], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
}); 

// API 3: Bar Chart (price ranges)
app.get('/bar-chart', (req, res) => {
    const { month } = req.query;
    const ranges = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];

    const query = `
        SELECT price, COUNT(*) as count
        FROM transactions
        WHERE strftime('%m', dateOfSale) = ?
        GROUP BY price
    `;

    db.all(query, [month], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let result = ranges.map((range, index) => {
            const upper = ranges[index + 1] || Infinity;
            const count = rows.filter(row => row.price >= range && row.price < upper).reduce((sum, row) => sum + row.count, 0);
            return { range: `${range}-${upper}`, count };
        });

        res.json(result);
    });
}); 

// API 4: Pie Chart (unique categories)
app.get('/pie-chart', (req, res) => {
    const { month } = req.query;

    db.all(`
        SELECT category, COUNT(*) AS count
        FROM transactions
        WHERE strftime('%m', dateOfSale) = ?
        GROUP BY category
    `, [month], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});



// API 5: Combined response
app.get('/combined', async (req, res) => {
    const { month } = req.query;

    const [transactions, stats, barChart, pieChart] = await Promise.all([
        new Promise((resolve, reject) => {
            db.all(`SELECT * FROM transactions WHERE strftime('%m', dateOfSale) = ?`, [month], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        }),
        new Promise((resolve, reject) => {
            db.get(`SELECT SUM(price) AS totalSales, COUNT(CASE WHEN sold = 1 THEN 1 END) AS soldItems, COUNT(CASE WHEN sold = 0 THEN 1 END) AS notSoldItems FROM transactions WHERE strftime('%m', dateOfSale) = ?`, [month], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        }),
        new Promise((resolve, reject) => {
            const ranges = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
            db.all(`SELECT price, COUNT(*) as count FROM transactions WHERE strftime('%m', dateOfSale) = ? GROUP BY price`, [month], (err, rows) => {
                if (err) reject(err);
                else {
                    let result = ranges.map((range, index) => {
                        const upper = ranges[index + 1] || Infinity;
                        const count = rows.filter(row => row.price >= range && row.price < upper).reduce((sum, row) => sum + row.count, 0);
                        return { range: `${range}-${upper}`, count };
                    });
                    resolve(result);
                }
            });
        }),
        new Promise((resolve, reject) => {
            db.all(`SELECT category, COUNT(*) AS count FROM transactions WHERE strftime('%m', dateOfSale) = ? GROUP BY category`, [month], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        })
    ]);

    res.json({ transactions, stats, barChart, pieChart });
});









app.listen(3000, () => {
    console.log('Server is running on port 3000');
});