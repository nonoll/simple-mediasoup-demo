const routerOptions = {
  mediaCodecs : [
    {
      kind      : 'audio',
      mimeType  : 'audio/opus',
      clockRate : 48000,
      channels  : 2
    },
    {
      kind       : 'video',
      mimeType   : 'video/VP8',
      clockRate  : 90000,
      parameters :
      {
        'x-google-start-bitrate' : 1000
      }
    },
    {
      kind       : 'video',
      mimeType   : 'video/VP9',
      clockRate  : 90000,
      parameters :
      {
        'profile-id'             : 2,
        'x-google-start-bitrate' : 1000
      }
    },
    {
      kind       : 'video',
      mimeType   : 'video/h264',
      clockRate  : 90000,
      parameters :
      {
        'packetization-mode'      : 1,
        'profile-level-id'        : '4d0032',
        'level-asymmetry-allowed' : 1,
        'x-google-start-bitrate'  : 1000
      }
    },
    {
      kind       : 'video',
      mimeType   : 'video/h264',
      clockRate  : 90000,
      parameters :
      {
        'packetization-mode'      : 1,
        'profile-level-id'        : '42e01f',
        'level-asymmetry-allowed' : 1,
        'x-google-start-bitrate'  : 1000
      }
    }
  ]
};

const webRtcTransportOptions = {
  listenIps: [
    { ip: '127.0.0.1', announcedIp: null }, // 자기 자신
    // { ip: '0.0.0.0', announcedIp: undefined }, // dhcp 서버, 공유기에 요청 > 할당가능한 ip 로 부여됨
  ],
  initialAvailableOutgoingBitrate : 1000000,
  minimumAvailableOutgoingBitrate : 600000,
  maxSctpMessageSize : 262144,
  maxIncomingBitrate : 1500000
}

module.exports = {
  routerOptions,
  webRtcTransportOptions
};
