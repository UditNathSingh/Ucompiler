const WebSocket = require('ws');
const ws = new WebSocket('ws://0.0.0.0:3000');
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: 'fake' })); // Since we fallback to 'dev-user@example.com (Dev Mode)' when no token? Wait.
});
ws.on('message', (data) => {
  console.log(JSON.parse(data));
});
