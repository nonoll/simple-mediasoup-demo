const https = require('https');
const express = require('express');
const cors = require('cors');
const socket = require('socket.io');
const createCertificate = require('./utils/createCertificate');

async function createExpressApp() {
  const expressApp = express();

  expressApp.use(cors());

  expressApp.get('/rooms/:roomId', (req, res) => {
    res.status(200).json({});
  });

  return expressApp;
}

async function createHttpsServer(expressApp) {
  const pem = createCertificate();
  const tls = {
    cert: Buffer.from(pem.cert),
    key: Buffer.from(pem.private),
  };
  const httpsServer = https.createServer(tls, expressApp);

  await new Promise(resolve => httpsServer.listen(4443, '0.0.0.0', resolve()));

  return httpsServer;
}

async function createSocketServer(httpsServer) {
  return socket(httpsServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  })
}

function attachSocketServerHandler(socketServer) {
  socketServer.on('connection', client => {
    console.log('connection');
    client.on('event', data => { /* … */ });
    client.on('disconnect', () => { /* … */ });
  });
}

async function run() {
  const expressApp = await createExpressApp();
  const httpsServer = await createHttpsServer(expressApp);
  const socketServer = await createSocketServer(httpsServer);
  attachSocketServerHandler(socketServer);
}

run();
