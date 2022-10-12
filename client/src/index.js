import { Device } from 'mediasoup-client';
import { io } from 'socket.io-client';

console.log('index.js');
console.log('Device', Device);
console.log('io', io);

const socket = io('wss://localhost:4443');
socket.on('connect', () => {
  console.log(socket.disconnected); // false
});
