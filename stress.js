const cron = require('node-cron');
const autocannon = require('autocannon');
const inquirer = require('inquirer');
const chalk = require('chalk');
const Q = require('q');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');
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
let isArtillaryTestRunning = false; // Flag to track if artillary is running

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

async function saveTarget(url, path, port) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO targets (url, path, port, active) VALUES (?, ?, ?, ?)`,
            [url, path, port, true], // Set the target as active by default
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

async function runAutocannonTest(url, port, path, scheme) {
    if (isTestRunning) {
        console.log(chalk.yellow('Test is already running.'));
        return;
    }

    isTestRunning = true; // Set the flag to true
    try {
        const fullUrl = `${scheme}://${url}:${port}${path}`;
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
}

// Handle the results after the test completes
function handleResults(err, result) {
    if (err) {
        console.error(chalk.red("An error occurred during the test:", err));
        return;
    }
    console.log(chalk.magenta(result));
}

// Function to run Thor.js WebSocket test
function runThorTest(host, port, amount, messages) {
    const artilleryCommand = `artillery quick — count ${amount} -n ${amount} ws://localhost:3000  --messages ${messages} ws://${host}:${port}`;
    exec(artilleryCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(chalk.red(`Error executing Thor.js command: ${error.message}`));
            return;
        }
        if (stderr) {
            console.error(chalk.red(`Thor.js stderr: ${stderr}`));
            return;
        }
        console.log(chalk.green(`Thor.js output:\n${stdout}`));
    });
}

// Main function to start or resume target processing
async function main() {
    const targets = await getTargets();
    if (targets.length === 0 || targets.every(target => !target.url)) {
        await promptUserForTarget();
    } else {
        console.log(chalk.yellow('Existing targets found. Running tests on them...'));
        for (const target of targets) {
            await runAutocannonTest(target.url,target.port, target.path, 'https');
            await runArtillaryTest(target.url, '5333', 1000000, 10, 'wss')
                .then(output => {
                    console.log(chalk.green('Artillery test completed successfully.'));
                })
                .catch(error => {
                    console.error(chalk.red('An error occurred during the Artillery test:', error));
                });
            // Uncomment the following line if you want to run Thor.js test as well
            // runThorTest(target.url, target.port, 1000, 100);
        }
    }
}

// Schedule the function to run periodically using node-cron
cron.schedule('*/1 * * * *', async () => {
    console.log(chalk.yellow('Checking if test needs to be started...'));
    await main();
});

// Define other necessary functions
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

// Function to run artillary WebSocket test
function runArtillaryTest(url, port, amount, messages , schema) {
    const deferred = Q.defer();

    try {
        isArtillaryTestRunning = true;
        const filepath = path.join(__dirname, 'websocket-test.yml');
        const fileyml = `websocket-test.yml`;

        // Construct the commands using the provided parameters
        const artilleryCommand = `npx artillery run ${fileyml}`;
        //first method
        // const artillerCmd = `npx artillery run --target ${schema}://${url}:${port} --amount ${amount} --messages ${messages}`;

        // second method
        const artillerCmd = `artillery quick — count ${amount} -n ${messages} ${schema}://${url}:${port}`;
        console.log(chalk.blue(`Starting Artillery test with command: ${artilleryCommand}`));
        console.log(chalk.blue(`Starting Artillery test with command: ${artillerCmd}`));

        // Execute the first Artillery command
        exec(artilleryCommand, (error, stdout, stderr) => {
            if (error) {
                deferred.reject(new Error(`Error executing Artillery command: ${error.message}`));
                return;
            }
            if (stderr) {
                console.error(chalk.red(`Artillery error output: ${stderr}`));
            }
            console.log(chalk.green(`Artillery output:\n${stdout}`));

            // Execute the second Artillery command
            exec(artillerCmd, (error, stdout, stderr) => {
                if (error) {
                    deferred.reject(new Error(`Error executing Artillery command: ${error.message}`));
                    return;
                }
                if (stderr) {
                    console.error(chalk.red(`Artillery error output: ${stderr}`));
                }
                console.log(chalk.green(`Artillery output:\n${stdout}`));
                deferred.resolve(stdout); // Resolve the promise after the second command completes
            });
        });
    } catch (error) {
        console.error(chalk.red("An error occurred during the test:", error));
        deferred.reject(error);
    } finally {
        isArtillaryTestRunning = false; // Reset the flag
    }

    return deferred.promise; // Return the promis
}

async function promptUserForTarget() {
    const targets = await getTargets();
    const choices = targets.map(target => ({
        name: `${target.url}:${target.port}${target.path} (Active: ${target.active ? 'Yes' : 'No'})`,
        value: target.id,
    }));

    targets.forEach(target => {
        console.table(chalk.green(`ID: ${target.id}, URL: ${target.url}, Port: ${target.port}, Scheme: ${target.scheme}, Path: ${target.path}`));
    });
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
                'Set New Target',
                'Enable Target',
                'Disable Target',
                'Skip to Main Menu',
                'Resume with Previous Changes'
            ],
        }
    ]);

    switch (answers.command) {
        case 'Run Tests on All Targets':
            if (!isTestRunning) {
                isTestRunning = true;
                isArtillaryTestRunning = true;
                await runTestsOnAllTargets();
                // await runArtillaryTest();
                isTestRunning = false;
            }
            break;
        case 'Show History Logs':
            await showHistoryLogs();
            break;
        case 'Show Current Target':
            await showCurrentTarget(answers.targetId);
            break;
        case 'Update Target':
            await updateSelectedTarget(answers.targetId);
            break;
        case 'Delete Target':
            await deleteSelectedTarget(answers.targetId);
            break;
        case 'Set New Target':
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
                },
                {
                    type: 'list',
                    name: 'action',
                    message: 'Choose an action:',
                    choices: ['Add Target', 'Run Autocannon Test', 'Run Artillery Test', 'Exit']
                }
            ]).then(answers => {
                if (answers.action === 'Add Target') {
                    inquirer.prompt([
                        {
                            type: 'input',
                            name: 'url',
                            message: 'Enter the target URL:',
                            validate: input => input ? true : 'URL cannot be empty.'
                        },
                        {
                            type: 'input',
                            name: 'path',
                            message: 'Enter the path (leave empty if none):'
                        },
                        {
                            type: 'list',
                            name: 'scheme',
                            message: 'Select the URL scheme:',
                            choices: ['http', 'https', 'ws', 'wss']
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: 'Enter the port number (leave empty for default port):',
                            filter: input => parseInt(input, 10) || undefined
                        }
                    ]).then(async (answers) => {
                        const { url, path, port, scheme } = answers;
                        try {
                            await saveTarget(url, path, port, scheme);
                            console.log(chalk.green('Target saved successfully.'));
                        } catch (error) {
                            console.error(chalk.red('Error saving target:', error));
                        }
                        main(); // Restart the main function
                    });
                } else if (answers.action === 'Run Autocannon Test') {
                    if (isTestRunning) {
                        console.log(chalk.yellow('Autocannon test is already running.'));
                        return;
                    }
        
                    inquirer.prompt([
                        {
                            type: 'input',
                            name: 'url',
                            message: 'Enter the target URL:',
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: 'Enter the port number:',
                            filter: input => parseInt(input, 10)
                        },
                        {
                            type: 'input',
                            name: 'path',
                            message: 'Enter the path (leave empty if none):',
                            default: '/'
                        },
                        {
                            type: 'list',
                            name: 'scheme',
                            message: 'Select the URL scheme:',
                            choices: ['http', 'https', 'ws', 'wss']
                        }
                    ]).then(answers => {
                        const { url, port, path, scheme } = answers;
                        runAutocannonTest(url, port, path, scheme);
                    });
                } else if (answers.action === 'Run Artillery Test') {
                    if (isArtillaryTestRunning) {
                        console.log(chalk.yellow('Artillery test is already running.'));
                        return;
                    }
        
                    inquirer.prompt([
                        {
                            type: 'input',
                            name: 'url',
                            message: 'Enter the target URL:',
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: 'Enter the port number:',
                            filter: input => parseInt(input, 10)
                        },
                        {
                            type: 'input',
                            name: 'amount',
                            message: 'Enter the number of connections:',
                            filter: input => parseInt(input, 10)
                        },
                        {
                            type: 'input',
                            name: 'messages',
                            message: 'Enter the number of messages to send:',
                            filter: input => parseInt(input, 10)
                        },
                        {
                            type: 'list',
                            name: 'scheme',
                            message: 'Select the URL scheme:',
                            choices: ['http', 'https', 'ws', 'wss']
                        }
                    ]).then(answers => {
                        const { url, port, amount, messages, scheme } = answers;
                        runArtillaryTest(url, port, amount, messages , scheme)
                        .then(output => {
                            console.log(chalk.green('Artillery test completed successfully.'));
                        })
                        .catch(error => {
                            console.error(chalk.red('An error occurred during the Artillery test:', error));
                        });
                        // runArtillaryTest(url, port, amount, messages , scheme);
                    });
                } else {
                    console.log(chalk.cyan('Exiting...'));
                    process.exit();
                }
            });

            const id = await saveTarget(url, path, port);
            console.log(chalk.green(`New target added with ID ${id}`));
            break;
        case 'Enable Target':
            await enableTarget(answers.targetId);
            break;
        case 'Disable Target':
            await disableTarget(answers.targetId);
            break;
        case 'Skip to Main Menu':
            await main();
            break;
        case 'Resume with Previous Changes':
            console.log(chalk.green('Resuming with previous changes...'));
            await main();
            break;
        default:
            console.log(chalk.red('Unknown command.'));
    }
}

async function getTargets() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM targets WHERE active = 1 ORDER BY timestamp DESC`, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

async function enableTarget(id) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE targets SET active = 1 WHERE id = ?`, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                console.log(chalk.green(`Target ${id} enabled successfully.`));
                resolve();
            }
        });
    });
}

async function disableTarget(id) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE targets SET active = 0 WHERE id = ?`, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                console.log(chalk.green(`Target ${id} disabled successfully.`));
                resolve();
            }
        });
    });
}


async function showHistoryLogs() {
    const targets = await getTargets();
    if (targets.length === 0) {
        console.log(chalk.yellow('No history logs available.'));
        return;
    }
    targets.forEach(target => {
        console.log(chalk.cyan(`ID: ${target.id}, URL: ${target.url}, Path: ${target.path}, Port: ${target.port}, Timestamp: ${target.timestamp}`));
    });
}

async function showCurrentTarget(id) {
    const target = await getCurrentTarget(id);
    if (!target) {
        console.log(chalk.red('Target not found.'));
        return;
    }
    console.log(chalk.cyan(`ID: ${target.id}, URL: ${target.url}, Path: ${target.path}, Port: ${target.port}, Timestamp: ${target.timestamp}`));
}

async function runTestsOnAllTargets() {
    const targets = await getTargets(true); // Get only active targets
    for (const target of targets) {
        await runAutocannonTest(target.url, target.port, target.path, 'https');
        await runArtillaryTest(target.url, '5333', 1000000, 10, 'wss')
        .then(output => {
            console.log(chalk.green('Artillery test completed successfully.'));
        })
        .catch(error => {
            console.error(chalk.red('An error occurred during the Artillery test:', error));
        });
        // Uncomment the following line if you want to run Artillery.js test as well
        // await runArtillaryTest(target.url, '5333', 1000000, 10, 'wss');
    }
}

async function getTargets(activeOnly = false) {
    return new Promise((resolve, reject) => {
        const query = activeOnly ? `SELECT * FROM targets WHERE active = 1 ORDER BY timestamp DESC` : `SELECT * FROM targets ORDER BY timestamp DESC`;
        db.all(query, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

async function updateSelectedTarget(id) {
    const target = await getCurrentTarget(id);
    if (!target) {
        console.log(chalk.red('Target not found.'));
        return;
    }

    const { url, path, port } = await inquirer.prompt([
        {
            type: 'input',
            name: 'url',
            message: 'Enter the new target URL:',
            default: target.url,
            validate: value => /^((https?|ftp):\/\/)?([a-zA-Z0-9.-]+)(:\d{1,5})?(\/.*)?$/.test(value) || 'Please enter a valid URL',
            filter: String
        },
        {
            type: 'input',
            name: 'path',
            message: 'Enter the new target path:',
            default: target.path,
            validate: value => /^\/[a-zA-Z0-9\/\-_.~%!$&'()*+,;=:@]*$/.test(value) || 'Please enter a valid path',
            filter: String
        },
        {
            type: 'input',
            name: 'port',
            message: 'Enter the new target port:',
            default: target.port,
            validate: value => /^\d+$/.test(value) || 'Please enter a valid port number',
            filter: Number
        }
    ]);

    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE targets SET url = ?, path = ?, port = ? WHERE id = ?`,
            [url, path, port, id],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(chalk.green(`Target ${id} updated successfully.`));
                    resolve();
                }
            }
        );
    });
}

async function deleteSelectedTarget(id) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM targets WHERE id = ?`, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                console.log(chalk.green(`Target ${id} deleted successfully.`));
                resolve();
            }
        });
    });
}

// async function runTestsOnAllTargets() {
//     const targets = await getTargets();
//     for (const target of targets) {
//         await runAutocannonTest(target.url, target.port, target.path);
//         // Uncomment the following line if you want to run Artillery.js test as well
//         // runThorTest(target.url, target.port, 1000, 100);
//           await runArtillaryTest(target.url, '5333', 1000000, 10, 'wss');
//     }
// }
