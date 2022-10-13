import { Device } from 'mediasoup-client';
import { io } from 'socket.io-client';
import { sortPeers } from './utils';

import * as apis from './apis';

const win = window;
const doc = win.document;

function displayVideoStream(container, videoTrack) {
  const video = doc.createElement('video');

  video.setAttribute('playsinline', true);
  video.setAttribute('autoplay', true);
  video.srcObject = new MediaStream([videoTrack.clone()]);

  container.appendChild(video);
  container.classList.add('is--active');

  video.play();
}

async function createTransport(device, direction, peerId) {
  const { transportOptions } = await apis.createTransport({ direction, peerId });
  const transport = direction === 'send' ? await device.createSendTransport(transportOptions) : await device.createRecvTransport(transportOptions);

  const { id: transportId } = transportOptions;

  // ! transport.produce 실행시 동작
  transport.on('connect', async ({ dtlsParameters }, resolve, reject) => {
    const { error } = await apis.connectTransport({ transportId, dtlsParameters });

    if (error) {
      reject();
      return;
    }

    resolve();
  });

  if (direction === 'send') {
    // ! transport connect resolve 이후 동작
    transport.on('produce', async ({ kind, rtpParameters, appData }, resolve, reject) => {
      const { error, id } = await apis.sendTrack({
        peerId,
        transportId,
        kind,
        rtpParameters,
        paused: false,
        appData
      });

      if (error) {
        reject();
        return;
      }

      resolve({ id });
    });
  }

  // transport.on('connectionstatechange', async (state) => {
  //   console.log(`transport ${transport.id} connectionstatechange ${state}`);
  // });

  return transport;
}

async function updatePeers(device, peerId, peers) {
  const container = doc.querySelector('.peers');
  const sortedPeers = sortPeers(peers);

  console.log('sortedPeers', sortedPeers.length - 1);

  for (const peer of sortedPeers) {
    if (peer.id === peerId) {
      continue;
    }

    for (const [mediaTag] of Object.entries(peer.media)) {
      const recvTransport = await createTransport(device, 'recv', peerId);
      const consumerParameters = await apis.recvTrack({
        peerId,
        mediaTag,
        mediaPeerId: peer.id,
        rtpCapabilities: device.rtpCapabilities,
      });
      const consumer = await recvTransport.consume({
        ...consumerParameters,
        appData: { peerId: peer.id, mediaTag },
      });

      if (consumer.track.kind !== 'video') {
        return;
      }

      recvTransport.on('connectionstatechange', state => {
        console.log('recvTransport connectionstatechange', state);
        if (state !== 'connected') {
          return;
        }

        displayVideoStream(container, consumer.track);
      });
    }
  }
}

async function init(peerId, socket) {
  const device = new Device();
  const { routerRtpCapabilities } = await apis.joinNewPeer({ peerId });

  await device.load({ routerRtpCapabilities });

  socket.on('changePeers', (peers) => {
    console.log(peers);
    updatePeers(device, peerId, peers);
  });

  const stream = await navigator.mediaDevices.getUserMedia({video: true});
  const videoTrack = stream.getVideoTracks()[0];

  const sendTransport = await createTransport(device, 'send', peerId);
  await sendTransport.produce({
    track: videoTrack,
    encodings: [
      { maxBitrate: 96000, scaleResolutionDownBy: 4 },
      { maxBitrate: 680000, scaleResolutionDownBy: 1 },
    ],
    appData: { mediaTag: 'cam-video' },
  });

  displayVideoStream(doc.querySelector('.me'), videoTrack);

  const leaveAction = () => {
    apis.leave({ peerId });
    sendTransport.close();
  };

  win.addEventListener('unload', leaveAction);
  doc.querySelector('#leave').addEventListener('click', leaveAction);
}

win.addEventListener('DOMContentLoaded', () => {
  const socket = io('wss://localhost:4443');
  const peerId = Date.now().toString();

  socket.on('connect', () => {
    if (socket.disconnected) {
      return;
    }

    init(peerId, socket);
  });
});
