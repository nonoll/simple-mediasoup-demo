const https = require('https');
const express = require('express');
const cors = require('cors');
const socket = require('socket.io');
const mediasoup = require('mediasoup');

const { createCertificate } = require('./utils');
const mediasoupConfig = require('./constants');

const API_ROUTE_PREFIX = '/api/v1';

const roomState = {
  peers: {},
  transports: {},
  producers: [],
  consumers: []
};

async function createExpressApp() {
  const expressApp = express();

  expressApp.use(cors());
  expressApp.use(express.json({ type: '*/*' }));

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

async function createMediasoup() {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });

  worker.on('died', () => {
    console.error('mediasoup worker died (this should never happen)');
    process.exit(1);
  });

  const { mediaCodecs } = mediasoupConfig.routerOptions;
  const router = await worker.createRouter({ mediaCodecs });

  const audioLevelObserver = await router.createAudioLevelObserver({
		interval: 800
	});

  audioLevelObserver.on('volumes', (volumes) => {
    const { producer, volume } = volumes[0];
    roomState.activeSpeaker.producerId = producer.id;
    roomState.activeSpeaker.volume = volume;
    roomState.activeSpeaker.peerId = producer.appData.peerId;
  });

  audioLevelObserver.on('silence', () => {
    roomState.activeSpeaker.producerId = null;
    roomState.activeSpeaker.volume = null;
    roomState.activeSpeaker.peerId = null;
  });

  return { worker, router, audioLevelObserver };
}

async function createWebRtcTransport({ router, peerId, direction }) {
  const {
    listenIps,
    initialAvailableOutgoingBitrate
  } = mediasoupConfig.webRtcTransportOptions;

  const transport = await router.createWebRtcTransport({
    listenIps: listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: initialAvailableOutgoingBitrate,
    appData: { peerId, clientDirection: direction }
  });

  return transport;
}

async function closeTransport(transport) {
  try {
    await transport.close();

    delete roomState.transports[transport.id];
  } catch (error) {
    console.error('closeTransport', error);
  }
}

async function closePeer(peerId) {
  for (const [__, transport] of Object.entries(roomState.transports)) {
    if (transport.appData.peerId === peerId) {
      await closeTransport(transport);
    }
  }

  delete roomState.peers[peerId];
}

function attachExpressAppHandler(expressApp, socketServer, { router, audioLevelObserver }) {
  expressApp.get('/rooms/:roomId', (__, res) => {
    res.status(200).json({});
  });

  expressApp.post(`${API_ROUTE_PREFIX}/joinNewPeer`, (req, res) => {
    const { peerId } = req.body;
    const now = Date.now();

    roomState.peers[peerId] = {
      joinTs: now,
      lastSeenTs: now,
      media: {},
      consumerLayers: {},
      stats: {}
    };

    res.status(200).json({ routerRtpCapabilities: router.rtpCapabilities });
  });

  expressApp.post(`${API_ROUTE_PREFIX}/createTransport`, async (req, res) => {
    const { peerId, direction } = req.body;
    const transport = await createWebRtcTransport({ router, direction, peerId });
    const { id, iceParameters, iceCandidates, dtlsParameters } = transport;

    roomState.transports[id] = transport;

    res.status(200).json({
      transportOptions: { id, iceParameters, iceCandidates, dtlsParameters }
    });
  });

  expressApp.post(`${API_ROUTE_PREFIX}/connectTransport`, async (req, res) => {
    try {
      const { transportId, dtlsParameters } = req.body;
      const transport = roomState.transports[transportId];

      if (!transport) {
        res.send({ error: `server-side transport ${transportId} not found` });
        return;
      }

      await transport.connect({ dtlsParameters });

      res.status(200).json({ connected: true });
    } catch (error) {
      res.send({ error });
    }
  });

  expressApp.post(`${API_ROUTE_PREFIX}/sendTrack`, async (req, res) => {
    try {
      const { peerId, transportId, kind, rtpParameters, paused = false, appData } = req.body;
      const transport = roomState.transports[transportId];

      if (!transport) {
        res.send({ error: `server-side transport ${transportId} not found`});
        return;
      }

      const producer = await transport.produce({
        kind,
        rtpParameters,
        paused,
        appData: { ...appData, peerId, transportId }
      });

      producer.on('transportclose', () => closeProducer(producer));

      if (producer.kind === 'audio') {
        audioLevelObserver.addProducer({ producerId: producer.id });
      }

      roomState.producers.push(producer);
      roomState.peers[peerId].media[appData.mediaTag] = {
        paused,
        encodings: rtpParameters.encodings
      };

      socketServer.emit('changePeers', roomState.peers);

      res.status(200).json({ id: producer.id });
    } catch (error) {
      res.send({ error });
    }
  });

  expressApp.post(`${API_ROUTE_PREFIX}/recvTrack`, async (req, res) => {
    try {
      const { peerId, mediaPeerId, mediaTag, rtpCapabilities } = req.body;

      const producer = roomState.producers.find((p) => p.appData.mediaTag === mediaTag && p.appData.peerId === mediaPeerId);

      if (!producer) {
        const msg = `server-side producer for ${mediaPeerId}:${mediaTag} not found`;
        res.send({ error: msg });
        return;
      }

      if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        const msg = `client cannot consume ${mediaPeerId}:${mediaTag}`;
        res.send({ error: msg });
        return;
      }

      const transport = Object.values(roomState.transports).find((t) => {
        return t.appData.peerId === peerId && t.appData.clientDirection === 'recv';
      });

      if (!transport) {
        const msg = `server-side recv transport for ${peerId} not found`;
        res.send({ error: msg });
        return;
      }

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        // paused: true, // see note above about always starting paused
        appData: { peerId, mediaPeerId, mediaTag }
      });

      consumer.on('transportclose', () => closeConsumer(consumer));
      consumer.on('producerclose', () => closeConsumer(consumer));

      roomState.consumers.push(consumer);
      roomState.peers[peerId].consumerLayers[consumer.id] = {
        currentLayer: null,
        clientSelectedLayer: null
      };

      // update above data structure when layer changes.
      consumer.on('layerschange', (layers) => {
        // console.log(`consumer layerschange ${mediaPeerId}->${peerId}`, mediaTag, layers);
        if (roomState.peers[peerId] && roomState.peers[peerId].consumerLayers[consumer.id]) {
          roomState.peers[peerId].consumerLayers[consumer.id].currentLayer = layers && layers.spatialLayer;
        }
      });

      const {id, kind, rtpParameters, type, producerPaused} = consumer;
      res.status(200).json({
        producerId: producer.id,
        id,
        kind,
        rtpParameters,
        type,
        producerPaused
      });
    } catch (error) {
      res.send({ error });
    }
  });

  expressApp.post(`${API_ROUTE_PREFIX}/leave`, async (req, res) => {
    console.log('leave', req.body.peerId);
    try {
      const { peerId } = req.body;

      await closePeer(peerId);

      socketServer.emit('changePeers', roomState.peers);

      res.send({ success: true });
    } catch (error) {
      res.send({ error });
    }
  });
}

function attachSocketServerHandler(socketServer) {
  socketServer.on('connection', client => {
    client.on('event', data => { /* … */ });
    client.on('disconnect', () => { /* … */ });
  });
}

async function run() {
  const expressApp = await createExpressApp();
  const httpsServer = await createHttpsServer(expressApp);
  const socketServer = await createSocketServer(httpsServer);
  const mediasoupInfo = await createMediasoup();

  attachExpressAppHandler(expressApp, socketServer, mediasoupInfo);
  attachSocketServerHandler(socketServer);
}

run();
