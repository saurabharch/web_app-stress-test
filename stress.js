const cron = require('node-cron');
const autocannon = require('autocannon');

async function runAutocannonTest() {
    try {
        const instance = autocannon({
            url: 'http://chatp.net',
            title: 'talkingchat',
            connections: 100,
            pipeline: 1,
            workers: 2,
            requests: [
                {
                    method: 'POST',
                    path: '/'
                }
            ]
        }, handleResults);

        instance.on('start', () => console.log("Test Started!"));
        instance.on('tick', () => console.log('ticking'));
        instance.on('response', handleResponse);

        // The instance is being tracked
        autocannon.track(instance, { renderProgressBar: false });

    } catch (err) {
        console.error("An error occurred during the test:", err);
    }
}

// The setupClient function
function setupClient(client) {
    client.on('body', console.log); // Log the response body when received
}

function handleResponse(client, statusCode, resBytes, responseTime) {
    console.log(`Got response with code ${statusCode} in ${responseTime} milliseconds`);
    console.log(`response: ${resBytes.toString()}`);

    // Update the body or headers
    client.setHeaders({ new: 'header' });
    client.setBody('new body');
    client.setHeadersAndBody({ new: 'header' }, 'new body');
}

function handleResults(err, result) {
    if (err) {
        console.error("An error occurred during the test:", err);
        return;
    }
    console.log(result);
    // Additional result handling logic can go here...
}

// Schedule the function to run periodically using node-cron
cron.schedule('*/1 * * * *', () => {
    console.log('Running autocannon test at the start of every minute');
    runAutocannonTest();
});
