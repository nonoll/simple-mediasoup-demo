import axios from 'axios';

import { API_URL } from '../constants/api';

export const joinNewPeer = async ({ peerId }) => {
  const response = await axios.post(`${API_URL}/joinNewPeer`, { peerId });

  return response.data;
}

export const createTransport = async ({ direction, peerId }) => {
  const response = await axios.post(`${API_URL}/createTransport`, { direction, peerId });

  return response.data;
}

export const connectTransport = async ({ transportId, dtlsParameters }) => {
  const response = await axios.post(`${API_URL}/connectTransport`, { transportId, dtlsParameters });

  return response.data;
}

export const sendTrack = async ({ peerId, transportId, kind, rtpParameters, paused, appData }) => {
  const response = await axios.post(`${API_URL}/sendTrack`, {
    peerId,
    transportId,
    kind,
    rtpParameters,
    paused,
    appData
  });

  return response.data;
}

export const recvTrack = async ({ peerId, mediaTag, mediaPeerId, rtpCapabilities }) => {
  const response = await axios.post(`${API_URL}/recvTrack`, {
    peerId,
    mediaTag,
    mediaPeerId,
    rtpCapabilities
  });

  return response.data;
}

export const leave = ({ peerId }) => {
  const body = JSON.stringify({ peerId });

  navigator.sendBeacon(`${API_URL}/leave`, body);
}
