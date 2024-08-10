const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 5333 });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    ws.send(msg);
  });
});

console.log('WebSockets server listening at wss://talkinchat.com:5333');