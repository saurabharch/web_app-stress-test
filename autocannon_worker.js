import { parentPort, workerData } from 'worker_threads';
import autocannon from 'autocannon';
import chalk from 'chalk';

async function runAutocannonTest(target) {
  const { url, path, port } = target;
  const instance = autocannon({
    url: `http://${url}:${port}${path}`,
    connections: 100,
    pipeline: 1,
    workers: 2,
    requests: [
      {
        method: 'POST',
        path: path,
        body: Buffer.alloc(1024, 'A').toString('utf-8'), // Generates 1024-byte body
      },
    ],
  });

  instance.on('start', () => {
    parentPort.postMessage(chalk.green(`Test Started on ${url}:${port}${path}`));
  });

  instance.on('response', (client, statusCode, resBytes, responseTime) => {
    parentPort.postMessage(
      chalk.blue(`Response from ${url}:${port}${path}: ${statusCode} in ${responseTime}ms`)
    );
  });

  autocannon.track(instance, { renderProgressBar: false });
}

runAutocannonTest(workerData);
