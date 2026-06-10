const fs = require('fs').promises;
const path = require('path');

const LOGS_FILE = path.join(__dirname, '..', 'src', 'DataFiles', 'logs.json');

async function getLogs() {
    try {
        const data = await fs.readFile(LOGS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

async function logAction(userEmail, action, details) {
    try {
        const logs = await getLogs();
        const newLog = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            user: userEmail || 'System',
            action: action,
            details: details
        };
        logs.unshift(newLog); // Add to beginning
        
        // Keep only last 1000 logs
        if (logs.length > 1000) logs.pop();

        await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error('Failed to write log:', error);
    }
}

module.exports = { getLogs, logAction };
