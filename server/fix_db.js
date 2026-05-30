const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'users.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Failed to open database:', err);
        return;
    }
    console.log('Connected to database.');
    
    db.run(`UPDATE users SET trust_score = 100 WHERE trust_score IS NULL OR trust_score = 0`, function(err) {
        if (err) {
            console.error('Failed to update trust scores:', err);
        } else {
            console.log(`Successfully updated ${this.changes} rows to trust_score = 100.`);
        }
        db.close();
    });
});
